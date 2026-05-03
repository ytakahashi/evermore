import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  let now: number;
  let workspaceApi: WorkspaceApiMock;
  let workspace: Workspace;

  beforeEach(() => {
    now = 2;
    workspace = createWorkspace('workspace-1', '/Users/tester');
    workspaceApi = {
      list: vi.fn(() => Promise.resolve([workspace])),
      get: vi.fn(() => Promise.resolve(workspace)),
      create: vi.fn(() => Promise.resolve(workspace)),
      update: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
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
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
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
    expect(selectActiveWorkspace(useStore.getState())?.updatedAt).toBe(now);
    expect(workspaceApi.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(workspaceApi.update).toHaveBeenCalledWith({ ...updatedWorkspace, updatedAt: now });
    vi.useRealTimers();
  });

  it('keeps only the latest debounced workspace update', async () => {
    // Given: repeated workspace updates happen within the debounce window.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();
    const firstUpdate = { ...workspace, name: 'First' };
    const secondUpdate = { ...workspace, name: 'Second' };

    // When: both updates are scheduled before the timer fires.
    useStore.getState().updateWorkspace(firstUpdate);
    now = 3;
    useStore.getState().updateWorkspace(secondUpdate);
    await vi.advanceTimersByTimeAsync(50);

    // Then: only the final workspace snapshot is persisted.
    expect(workspaceApi.update).toHaveBeenCalledOnce();
    expect(workspaceApi.update).toHaveBeenCalledWith({ ...secondUpdate, updatedAt: now });
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

  it('adds a tab with a new pane rooted at the current active pane cwd', async () => {
    // Given: a loaded workspace with a deterministic id generator.
    vi.useFakeTimers();
    const ids = ['tab-2', 'pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();

    // When: a new tab is added.
    useStore.getState().addTab();
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());

    // Then: the tab becomes active and its pane starts from the previous active cwd.
    expect(updatedWorkspace?.activeTabId).toBe('tab-2');
    expect(updatedWorkspace?.updatedAt).toBe(now);
    expect(updatedWorkspace?.tabs).toHaveLength(2);
    expect(updatedWorkspace?.tabs[1]).toEqual({
      id: 'tab-2',
      title: 'zsh',
      layout: {
        type: 'leaf',
        paneId: 'pane-2',
      },
      activePaneId: 'pane-2',
    });
    expect(updatedWorkspace?.panes[1]).toEqual({
      id: 'pane-2',
      cwd: '/Users/tester',
      title: 'zsh',
    });
  });

  it('selects a tab and persists the active tab id', async () => {
    // Given: a workspace has two tabs.
    vi.useFakeTimers();
    const secondTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        ...workspace.tabs,
        {
          id: 'tab-2',
          title: 'zsh',
          layout: {
            type: 'leaf',
            paneId: 'pane-2',
          },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        ...workspace.panes,
        {
          id: 'pane-2',
          cwd: '/Users/tester',
          title: 'zsh',
        },
      ],
    };
    workspaceApi.list = vi.fn(() => Promise.resolve([secondTabWorkspace]));
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the second tab is selected.
    useStore.getState().selectTab('tab-2');
    await vi.advanceTimersByTimeAsync(50);

    // Then: active tab state updates locally and is scheduled for persistence.
    expect(selectActiveTab(useStore.getState())?.id).toBe('tab-2');
    expect(selectActiveWorkspace(useStore.getState())?.updatedAt).toBe(now);
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        activeTabId: 'tab-2',
        updatedAt: now,
      }),
    );
  });

  it('closes a tab, removes its pane, and keeps the final tab open', async () => {
    // Given: a loaded workspace with two tabs.
    vi.useFakeTimers();
    const ids = ['tab-2', 'pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    useStore.getState().addTab();

    // When: the active tab is closed.
    useStore.getState().closeTab('tab-2');

    // Then: the previous tab becomes active and the closed tab's pane is removed.
    let updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.activeTabId).toBe('workspace-1-tab-1');
    expect(updatedWorkspace?.updatedAt).toBe(now);
    expect(updatedWorkspace?.tabs).toHaveLength(1);
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['workspace-1-pane-1']);

    // When: callers try to close the only remaining tab.
    useStore.getState().closeTab('workspace-1-tab-1');

    // Then: the store keeps one tab available.
    updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs).toHaveLength(1);
    expect(updatedWorkspace?.activeTabId).toBe('workspace-1-tab-1');
  });

  it('closes an inactive tab without changing the active tab', async () => {
    // Given: tab-1 is active and tab-2 exists.
    vi.useFakeTimers();
    const secondTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        ...workspace.tabs,
        {
          id: 'tab-2',
          title: 'zsh',
          layout: {
            type: 'leaf',
            paneId: 'pane-2',
          },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        ...workspace.panes,
        {
          id: 'pane-2',
          cwd: '/Users/tester',
          title: 'zsh',
        },
      ],
      activeTabId: 'workspace-1-tab-1',
    };
    workspaceApi.list = vi.fn(() => Promise.resolve([secondTabWorkspace]));
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the inactive tab is closed.
    useStore.getState().closeTab('tab-2');

    // Then: the original active tab remains active while the inactive pane is removed.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.activeTabId).toBe('workspace-1-tab-1');
    expect(updatedWorkspace?.updatedAt).toBe(now);
    expect(updatedWorkspace?.tabs.map((tab) => tab.id)).toEqual(['workspace-1-tab-1']);
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['workspace-1-pane-1']);
  });
});
