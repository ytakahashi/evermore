import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../shared/types';
import type { Logger } from '../logging/logger';
import { WorkspaceStore } from './workspace-store';
import type { WorkspaceStorageAdapter } from './types';

class MemoryWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  public workspaces: Workspace[];
  public activeWorkspaceId: string | null;

  public constructor(workspaces: Workspace[] = [], activeWorkspaceId: string | null = null) {
    this.workspaces = workspaces;
    this.activeWorkspaceId = activeWorkspaceId;
  }

  public getWorkspaces(): Workspace[] {
    return this.workspaces;
  }

  public setWorkspaces(workspaces: Workspace[]): void {
    this.workspaces = workspaces;
  }

  public getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
  }

  public setActiveWorkspaceId(id: string | null): void {
    this.activeWorkspaceId = id;
  }
}

describe('WorkspaceStore', () => {
  let storage: MemoryWorkspaceStorageAdapter;
  let ids: string[];
  let now: number;
  let store: WorkspaceStore;

  beforeEach(() => {
    storage = new MemoryWorkspaceStorageAdapter();
    ids = ['workspace-1', 'tab-1', 'pane-1', 'workspace-2', 'tab-2', 'pane-2'];
    now = 1_700_000_000_000;
    store = new WorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      getHomeDirectory: () => '/Users/tester',
      getShellPath: () => '/bin/zsh',
      now: () => now,
      storage,
    });
  });

  it('creates a default workspace when storage is empty', () => {
    // Given: no workspaces have been persisted yet.

    // When: callers list available workspaces.
    const workspaces = store.list();

    // Then: the store persists and returns the initial single-tab workspace.
    expect(workspaces).toEqual([
      {
        id: 'workspace-1',
        name: 'Default',
        rootPath: '/Users/tester',
        tabs: [
          {
            id: 'tab-1',
            name: 'zsh',
            layout: {
              type: 'leaf',
              paneId: 'pane-1',
            },
            activePaneId: 'pane-1',
          },
        ],
        panes: [
          {
            id: 'pane-1',
            cwd: '/Users/tester',
          },
        ],
        activeTabId: 'tab-1',
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(storage.workspaces).toEqual(workspaces);
  });

  it('creates, gets, updates, and deletes workspaces', () => {
    // Given: the default workspace exists.
    const defaultWorkspace = store.list()[0];

    // When: another workspace is created and then updated.
    now += 1;
    const projectWorkspace = store.create('Project', '/Users/tester/project');
    now += 1;
    store.update({
      ...projectWorkspace,
      name: 'Renamed Project',
      panes: [
        {
          ...projectWorkspace.panes[0],
          cwd: '/Users/tester/project/src',
        },
      ],
    });

    // Then: lookup returns the updated workspace alongside the untouched default workspace.
    expect(store.get(defaultWorkspace?.id ?? '')).toEqual(defaultWorkspace);
    expect(store.get(projectWorkspace.id)).toEqual(
      expect.objectContaining({
        id: 'workspace-2',
        name: 'Renamed Project',
        rootPath: '/Users/tester/project',
        updatedAt: now,
      }),
    );
    expect(store.get(projectWorkspace.id)?.panes[0]?.cwd).toBe('/Users/tester/project/src');

    // When: the project workspace is deleted.
    store.delete(projectWorkspace.id);

    // Then: only the default workspace remains.
    expect(store.list()).toEqual([defaultWorkspace]);
  });

  it('does not persist runtime pane state', () => {
    // Given: a workspace update includes runtime pane state from the renderer.
    const workspace = store.list()[0];
    if (!workspace) {
      throw new Error('Expected default workspace to be created.');
    }

    // When: the workspace is persisted.
    store.update({
      ...workspace,
      panes: [
        {
          ...workspace.panes[0],
          initialCommand: "ssh 'dev'",
          ptyId: 'pty-runtime-1',
        },
      ],
    });

    // Then: storage receives the pane without runtime-only process state or replay commands.
    expect(storage.workspaces[0]?.panes[0]).toEqual({
      id: 'pane-1',
      cwd: '/Users/tester',
    });
  });

  it('does not delete the final workspace', () => {
    // Given: one default workspace exists.
    const defaultWorkspace = store.list()[0];
    if (!defaultWorkspace) {
      throw new Error('Expected default workspace to be created.');
    }

    // When: it is deleted.
    store.delete(defaultWorkspace.id);

    // Then: the store preserves the final workspace.
    expect(store.list()).toEqual([defaultWorkspace]);
  });

  it('moves the active workspace id when the active workspace is deleted', () => {
    // Given: the active workspace points at the second workspace.
    const defaultWorkspace = store.list()[0];
    if (!defaultWorkspace) {
      throw new Error('Expected default workspace to be created.');
    }
    const projectWorkspace = store.create('Project', '/Users/tester/project');
    store.setActiveWorkspaceId(projectWorkspace.id);

    // When: the active workspace is deleted.
    store.delete(projectWorkspace.id);

    // Then: the remaining workspace becomes active.
    expect(store.list()).toEqual([defaultWorkspace]);
    expect(store.getActiveWorkspaceId()).toBe(defaultWorkspace.id);
  });

  it('preserves the active workspace id when deleting an inactive workspace', () => {
    // Given: the first workspace is active and another workspace exists.
    const defaultWorkspace = store.list()[0];
    if (!defaultWorkspace) {
      throw new Error('Expected default workspace to be created.');
    }
    const projectWorkspace = store.create('Project', '/Users/tester/project');
    store.setActiveWorkspaceId(defaultWorkspace.id);

    // When: the inactive workspace is deleted.
    store.delete(projectWorkspace.id);

    // Then: the active workspace id remains unchanged.
    expect(store.list()).toEqual([defaultWorkspace]);
    expect(store.getActiveWorkspaceId()).toBe(defaultWorkspace.id);
  });

  it('does not write to storage when list() is called on existing workspaces', () => {
    // Given: workspaces already exist in storage.
    const defaultWorkspace = store.list()[0];
    if (!defaultWorkspace) {
      throw new Error('Expected default workspace to be created.');
    }

    let writeCount = 0;
    const originalSetWorkspaces = storage.setWorkspaces.bind(storage);
    storage.setWorkspaces = (workspaces) => {
      writeCount++;
      originalSetWorkspaces(workspaces);
    };

    // When: callers list available workspaces.
    store.list();

    // Then: no storage writes occur.
    expect(writeCount).toBe(0);
  });

  it('persists and retrieves the active workspace id independently of workspaces', () => {
    // Given: the default workspace exists.
    const workspace = store.list()[0];
    if (!workspace) throw new Error('Expected default workspace.');

    // When: the renderer sets the active workspace id.
    store.setActiveWorkspaceId(workspace.id);

    // Then: the persisted value is readable.
    expect(store.getActiveWorkspaceId()).toBe(workspace.id);
    expect(storage.activeWorkspaceId).toBe(workspace.id);

    // When: the active id is cleared.
    store.setActiveWorkspaceId(null);

    // Then: null is persisted and returned.
    expect(store.getActiveWorkspaceId()).toBeNull();
  });

  it('uses the current shell basename for the initial tab name', () => {
    // Given: the platform reports a non-default shell path.
    store = new WorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      getHomeDirectory: () => '/Users/tester',
      getShellPath: () => '/opt/homebrew/bin/fish',
      now: () => now,
      storage,
    });

    // When: the default workspace is created.
    const workspace = store.list()[0];

    // Then: the shell basename is used as the user-facing tab name.
    expect(workspace?.tabs[0]?.name).toBe('fish');
    expect(workspace?.panes[0]).toEqual({
      id: 'pane-1',
      cwd: '/Users/tester',
    });
  });

  it('migrates legacy tab titles and drops legacy pane titles', () => {
    // Given: storage contains the previous persisted shape.
    const legacyWorkspace = {
      id: 'legacy-workspace',
      name: 'Legacy',
      rootPath: '/Users/tester/legacy',
      tabs: [
        {
          id: 'legacy-tab',
          title: 'legacy-tab-title',
          layout: {
            type: 'leaf' as const,
            paneId: 'legacy-pane',
          },
          activePaneId: 'legacy-pane',
        },
      ],
      panes: [
        {
          id: 'legacy-pane',
          cwd: '/Users/tester/legacy',
          title: 'legacy-pane-title',
        },
      ],
      activeTabId: 'legacy-tab',
      createdAt: now,
      updatedAt: now,
    };
    storage = new MemoryWorkspaceStorageAdapter(
      [legacyWorkspace as unknown as Workspace],
      'legacy-workspace',
    );
    store = new WorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      getHomeDirectory: () => '/Users/tester',
      getShellPath: () => '/bin/zsh',
      now: () => now,
      storage,
    });

    // When: callers load the workspace list.
    const workspaces = store.list();

    // Then: the persisted data is normalized to the current model.
    expect(workspaces[0]?.tabs[0]).toEqual({
      id: 'legacy-tab',
      name: 'legacy-tab-title',
      layout: {
        type: 'leaf',
        paneId: 'legacy-pane',
      },
      activePaneId: 'legacy-pane',
    });
    expect(workspaces[0]?.panes[0]).toEqual({
      id: 'legacy-pane',
      cwd: '/Users/tester/legacy',
    });
    expect(storage.workspaces).toEqual(workspaces);
  });

  describe('global pane id uniqueness', () => {
    function workspaceWithPane(id: string, paneId: string, cwd: string): Workspace {
      return {
        id,
        name: id,
        rootPath: cwd,
        tabs: [
          {
            id: `${id}-tab`,
            name: 'zsh',
            layout: { type: 'leaf', paneId },
            activePaneId: paneId,
          },
        ],
        panes: [{ id: paneId, cwd }],
        activeTabId: `${id}-tab`,
        createdAt: now,
        updatedAt: now,
      };
    }

    function buildStore(
      workspaces: Workspace[],
      generatedIds: string[],
      logger?: Logger,
    ): {
      store: WorkspaceStore;
      storage: MemoryWorkspaceStorageAdapter;
    } {
      const seededStorage = new MemoryWorkspaceStorageAdapter(
        workspaces,
        workspaces[0]?.id ?? null,
      );
      const seededStore = new WorkspaceStore({
        createId: () => generatedIds.shift() ?? 'fallback-id',
        getHomeDirectory: () => '/Users/tester',
        getShellPath: () => '/bin/zsh',
        logger,
        now: () => now,
        storage: seededStorage,
      });
      return { store: seededStore, storage: seededStorage };
    }

    function createTestLogger(): Logger {
      return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(() => createTestLogger()),
      };
    }

    it('remaps a pane id that collides across workspaces and persists the fix', () => {
      // Given: two persisted workspaces that both reuse the pane id "pane-shared".
      const { store: seededStore, storage: seededStorage } = buildStore(
        [
          workspaceWithPane('workspace-1', 'pane-shared', '/Users/tester/one'),
          workspaceWithPane('workspace-2', 'pane-shared', '/Users/tester/two'),
        ],
        ['pane-unique'],
      );

      // When: callers load the workspace list.
      const workspaces = seededStore.list();

      // Then: the first keeps the id and the second is remapped consistently across pane, layout,
      // and active pane reference.
      expect(workspaces[0]?.panes[0]?.id).toBe('pane-shared');
      expect(workspaces[1]?.panes[0]?.id).toBe('pane-unique');
      expect(workspaces[1]?.tabs[0]?.layout).toEqual({ type: 'leaf', paneId: 'pane-unique' });
      expect(workspaces[1]?.tabs[0]?.activePaneId).toBe('pane-unique');

      // And: the normalized result is written back so the fix survives the next launch.
      expect(seededStorage.workspaces).toEqual(workspaces);
    });

    it('leaves globally unique pane ids untouched and does not write back', () => {
      // Given: two persisted workspaces whose pane ids are already unique.
      const createId = (): string => {
        throw new Error('createId should not be called when no pane id collides.');
      };
      const seededStorage = new MemoryWorkspaceStorageAdapter(
        [
          workspaceWithPane('workspace-1', 'pane-1', '/Users/tester/one'),
          workspaceWithPane('workspace-2', 'pane-2', '/Users/tester/two'),
        ],
        'workspace-1',
      );
      const seededStore = new WorkspaceStore({
        createId,
        getHomeDirectory: () => '/Users/tester',
        getShellPath: () => '/bin/zsh',
        now: () => now,
        storage: seededStorage,
      });
      let writeCount = 0;
      const originalSetWorkspaces = seededStorage.setWorkspaces.bind(seededStorage);
      seededStorage.setWorkspaces = (workspaces): void => {
        writeCount++;
        originalSetWorkspaces(workspaces);
      };

      // When: callers load the workspace list.
      const workspaces = seededStore.list();

      // Then: nothing is remapped and storage is not rewritten.
      expect(workspaces[0]?.panes[0]?.id).toBe('pane-1');
      expect(workspaces[1]?.panes[0]?.id).toBe('pane-2');
      expect(writeCount).toBe(0);
    });

    it('keeps a newly created workspace globally unique before persisting and returning it', () => {
      // Given: the next generated workspace pane id collides with an existing workspace.
      const seededStorage = new MemoryWorkspaceStorageAdapter(
        [workspaceWithPane('workspace-existing', 'pane-colliding', '/Users/tester/existing')],
        'workspace-existing',
      );
      const seededStore = new WorkspaceStore({
        createId: vi
          .fn()
          .mockReturnValueOnce('workspace-new')
          .mockReturnValueOnce('tab-new')
          .mockReturnValueOnce('pane-colliding')
          .mockReturnValueOnce('pane-remapped'),
        getHomeDirectory: () => '/Users/tester',
        getShellPath: () => '/bin/zsh',
        now: () => now,
        storage: seededStorage,
      });

      // When: a new workspace is created.
      const created = seededStore.create('Project', '/Users/tester/project');

      // Then: both the returned workspace and persisted workspace use the remapped pane id.
      expect(created.panes[0]?.id).toBe('pane-remapped');
      expect(created.tabs[0]?.layout).toEqual({ type: 'leaf', paneId: 'pane-remapped' });
      expect(created.tabs[0]?.activePaneId).toBe('pane-remapped');
      expect(seededStorage.workspaces[1]).toEqual(created);
    });

    it('keeps an updated workspace globally unique before persisting it', () => {
      // Given: updating the second workspace would make its pane id collide with the first.
      const first = workspaceWithPane('workspace-1', 'pane-shared', '/Users/tester/one');
      const second = workspaceWithPane('workspace-2', 'pane-original', '/Users/tester/two');
      const { store: seededStore, storage: seededStorage } = buildStore(
        [first, second],
        ['pane-remapped'],
      );

      // When: the renderer sends an update whose pane id collides globally.
      seededStore.update({
        ...second,
        tabs: [
          {
            ...second.tabs[0]!,
            layout: { type: 'leaf', paneId: 'pane-shared' },
            activePaneId: 'pane-shared',
          },
        ],
        panes: [{ id: 'pane-shared', cwd: '/Users/tester/two' }],
      });

      // Then: storage still satisfies the global uniqueness invariant.
      const updatedSecond = seededStorage.workspaces[1];
      expect(updatedSecond?.panes).toEqual([{ id: 'pane-remapped', cwd: '/Users/tester/two' }]);
      expect(updatedSecond?.tabs[0]?.layout).toEqual({ type: 'leaf', paneId: 'pane-remapped' });
      expect(updatedSecond?.tabs[0]?.activePaneId).toBe('pane-remapped');
    });

    it('self-heals a pane id duplicated within a workspace by dropping the orphan duplicate', () => {
      // Given: a corrupt workspace whose pane list repeats an id the layout references only once.
      const logger = createTestLogger();
      const corrupt: Workspace = {
        ...workspaceWithPane('workspace-1', 'dup', '/Users/tester'),
        panes: [
          { id: 'dup', cwd: '/Users/tester/a' },
          { id: 'dup', cwd: '/Users/tester/b' },
        ],
      };
      const { store: seededStore, storage: seededStorage } = buildStore([corrupt], [], logger);

      // When: callers load the workspace list.
      const workspaces = seededStore.list();

      // Then: the app recovers in place — the first (layout-referenced) pane is kept, the orphan
      // duplicate is dropped, and the validator-clean result is persisted.
      expect(workspaces[0]?.panes).toEqual([{ id: 'dup', cwd: '/Users/tester/a' }]);
      expect(workspaces[0]?.tabs[0]?.layout).toEqual({ type: 'leaf', paneId: 'dup' });
      expect(workspaces[0]?.tabs[0]?.activePaneId).toBe('dup');
      expect(seededStorage.workspaces).toEqual(workspaces);
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('drops panes that no layout leaf references', () => {
      // Given: a workspace carrying an orphan pane absent from its layout.
      const logger = createTestLogger();
      const corrupt: Workspace = {
        ...workspaceWithPane('workspace-1', 'kept-pane', '/Users/tester'),
        panes: [
          { id: 'kept-pane', cwd: '/Users/tester' },
          { id: 'orphan-pane', cwd: '/Users/tester/orphan' },
        ],
      };
      const { store: seededStore } = buildStore([corrupt], [], logger);

      // When: callers load the workspace list.
      const workspaces = seededStore.list();

      // Then: only the referenced pane survives.
      expect(workspaces[0]?.panes).toEqual([{ id: 'kept-pane', cwd: '/Users/tester' }]);
      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it('self-heals duplicated layout leaves by synthesizing a distinct pane', () => {
      // Given: a corrupt workspace whose split layout points two leaves at the same pane id.
      const logger = createTestLogger();
      const corrupt: Workspace = {
        id: 'workspace-1',
        name: 'workspace-1',
        rootPath: '/Users/tester/root',
        tabs: [
          {
            id: 'workspace-1-tab',
            name: 'zsh',
            layout: {
              type: 'split',
              direction: 'vertical',
              ratio: 0.5,
              children: [
                { type: 'leaf', paneId: 'dup' },
                { type: 'leaf', paneId: 'dup' },
              ],
            },
            activePaneId: 'dup',
          },
        ],
        panes: [{ id: 'dup', cwd: '/Users/tester/dup' }],
        activeTabId: 'workspace-1-tab',
        createdAt: now,
        updatedAt: now,
      };
      const { store: seededStore } = buildStore([corrupt], ['synthesized-pane'], logger);

      // When: callers load the workspace list.
      const workspaces = seededStore.list();

      // Then: each leaf resolves to its own pane; the second leaf gets a distinct pane cloned from
      // the referenced one (same cwd), leaving the result unique and fully referenced.
      expect(workspaces[0]?.tabs[0]?.layout).toEqual({
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'leaf', paneId: 'dup' },
          { type: 'leaf', paneId: 'synthesized-pane' },
        ],
      });
      expect(workspaces[0]?.panes).toEqual([
        { id: 'dup', cwd: '/Users/tester/dup' },
        { id: 'synthesized-pane', cwd: '/Users/tester/dup' },
      ]);
      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });
});
