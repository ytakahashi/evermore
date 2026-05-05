import { beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '../../shared/types';
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
            title: 'zsh',
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
            title: 'zsh',
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
      title: 'zsh',
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

  it('uses the current shell basename for initial tab and pane titles', () => {
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

    // Then: the shell basename is used as the user-facing terminal title.
    expect(workspace?.tabs[0]?.title).toBe('fish');
    expect(workspace?.panes[0]?.title).toBe('fish');
  });
});
