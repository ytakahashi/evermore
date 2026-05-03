import { beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '../../shared/types';
import { WorkspaceStore } from './workspace-store';
import type { WorkspaceStorageAdapter } from './types';

class MemoryWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  public workspaces: Workspace[];

  public constructor(workspaces: Workspace[] = []) {
    this.workspaces = workspaces;
  }

  public getWorkspaces(): Workspace[] {
    return this.workspaces;
  }

  public setWorkspaces(workspaces: Workspace[]): void {
    this.workspaces = workspaces;
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

  it('does not persist runtime PTY ids', () => {
    // Given: a workspace update includes a runtime PTY id from the renderer.
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
          ptyId: 'pty-runtime-1',
        },
      ],
    });

    // Then: storage receives the pane without runtime-only process state.
    expect(storage.workspaces[0]?.panes[0]).toEqual({
      id: 'pane-1',
      cwd: '/Users/tester',
      title: 'zsh',
    });
  });

  it('regenerates the default workspace when the final workspace is deleted', () => {
    // Given: one default workspace exists.
    const defaultWorkspace = store.list()[0];
    if (!defaultWorkspace) {
      throw new Error('Expected default workspace to be created.');
    }

    // When: it is deleted.
    store.delete(defaultWorkspace.id);

    // Then: a replacement default workspace keeps the app bootable.
    expect(store.list()).toEqual([
      expect.objectContaining({
        id: 'workspace-2',
        name: 'Default',
        rootPath: '/Users/tester',
      }),
    ]);
  });
});
