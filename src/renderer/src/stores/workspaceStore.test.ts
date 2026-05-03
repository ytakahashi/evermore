import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../shared/types';
import {
  createWorkspaceStore,
  selectActivePane,
  selectActiveTab,
  selectActiveWorkspace,
} from './workspaceStore';

type WorkspaceApiMock = Window['api']['workspace'];

function createWorkspace(id: string, cwd: string): Workspace {
  return {
    id,
    name: id === 'workspace-1' ? 'Default' : 'Project',
    rootPath: cwd,
    tabs: [
      {
        id: `${id}-tab-1`,
        title: 'zsh',
        layout: {
          type: 'leaf',
          paneId: `${id}-pane-1`,
        },
        activePaneId: `${id}-pane-1`,
      },
    ],
    panes: [
      {
        id: `${id}-pane-1`,
        cwd,
        title: 'zsh',
      },
    ],
    activeTabId: `${id}-tab-1`,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('workspaceStore', () => {
  let workspaceApi: WorkspaceApiMock;
  let workspace: Workspace;

  beforeEach(() => {
    workspace = createWorkspace('workspace-1', '/Users/tester');
    workspaceApi = {
      list: vi.fn(() => Promise.resolve([workspace])),
      get: vi.fn(() => Promise.resolve(workspace)),
      create: vi.fn(() => Promise.resolve(workspace)),
      update: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
  });

  it('loads workspaces and selects the active workspace, tab, and pane', async () => {
    // Given: the preload workspace API returns persisted workspaces.
    const useStore = createWorkspaceStore({ workspaceApi });

    // When: renderer state is loaded.
    await useStore.getState().loadWorkspaces();
    const state = useStore.getState();

    // Then: the first workspace is active and selectors resolve the active terminal pane.
    expect(workspaceApi.list).toHaveBeenCalledOnce();
    expect(state.activeWorkspaceId).toBe('workspace-1');
    expect(selectActiveWorkspace(state)).toBe(workspace);
    expect(selectActiveTab(state)).toBe(workspace.tabs[0]);
    expect(selectActivePane(state)).toBe(workspace.panes[0]);
  });

  it('updates local state immediately and persists after the debounce interval', async () => {
    // Given: a loaded workspace store using fake timers.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50 });
    await useStore.getState().loadWorkspaces();

    // When: a workspace is updated.
    const updatedWorkspace = {
      ...workspace,
      panes: [
        {
          ...workspace.panes[0],
          cwd: '/Users/tester/project',
        },
      ],
    };
    useStore.getState().updateWorkspace(updatedWorkspace);

    // Then: state updates immediately but persistence waits for the debounce timer.
    expect(selectActivePane(useStore.getState())?.cwd).toBe('/Users/tester/project');
    expect(workspaceApi.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(workspaceApi.update).toHaveBeenCalledWith(updatedWorkspace);
    vi.useRealTimers();
  });

  it('keeps only the latest debounced workspace update', async () => {
    // Given: repeated workspace updates happen within the debounce window.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50 });
    await useStore.getState().loadWorkspaces();
    const firstUpdate = { ...workspace, name: 'First' };
    const secondUpdate = { ...workspace, name: 'Second' };

    // When: both updates are scheduled before the timer fires.
    useStore.getState().updateWorkspace(firstUpdate);
    useStore.getState().updateWorkspace(secondUpdate);
    await vi.advanceTimersByTimeAsync(50);

    // Then: only the final workspace snapshot is persisted.
    expect(workspaceApi.update).toHaveBeenCalledOnce();
    expect(workspaceApi.update).toHaveBeenCalledWith(secondUpdate);
    vi.useRealTimers();
  });

  it('stores an error message when loading workspaces fails', async () => {
    // Given: the preload workspace API rejects.
    workspaceApi.list = vi.fn(() => Promise.reject(new Error('load failed')));
    const useStore = createWorkspaceStore({ workspaceApi });

    // When: renderer state attempts to load.
    await useStore.getState().loadWorkspaces();

    // Then: the error is available to the UI.
    expect(useStore.getState().error).toBe('load failed');
    expect(useStore.getState().isLoading).toBe(false);
  });
});
