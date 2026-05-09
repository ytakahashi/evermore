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
        name: 'zsh',
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
      list: vi.fn(() => Promise.resolve({ workspaces: [workspace], activeWorkspaceId: null })),
      get: vi.fn(() => Promise.resolve(workspace)),
      create: vi.fn(() => Promise.resolve(workspace)),
      update: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
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

  it('restores the persisted active workspace id on load', async () => {
    // Given: two workspaces are persisted and the second was the last active.
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({
        workspaces: [workspace, workspace2],
        activeWorkspaceId: 'workspace-2',
      }),
    );
    const useStore = createWorkspaceStore({ workspaceApi });

    // When: renderer state is loaded.
    await useStore.getState().loadWorkspaces();

    // Then: the second workspace is active without writing anything back.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(workspaceApi.setActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it('falls back to the first workspace when the persisted active id is stale', async () => {
    // Given: the persisted active id no longer matches any workspace.
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace], activeWorkspaceId: 'deleted-workspace' }),
    );
    const useStore = createWorkspaceStore({ workspaceApi });

    // When: renderer state is loaded.
    await useStore.getState().loadWorkspaces();

    // Then: the first available workspace is selected.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
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

  it('updates pane cwd immediately and persists it after the cwd debounce interval', async () => {
    // Given: a loaded workspace store using the longer cwd debounce window.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({
      workspaceApi,
      cwdDebounceMs: 100,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();

    // When: OSC 7 reports a new cwd for a pane.
    useStore.getState().updatePaneCwd('workspace-1-pane-1', '/Users/tester/project');

    // Then: local state updates immediately, while persistence waits for the cwd debounce timer.
    expect(selectActivePane(useStore.getState())?.cwd).toBe('/Users/tester/project');
    expect(selectActiveWorkspace(useStore.getState())?.updatedAt).toBe(now);
    await vi.advanceTimersByTimeAsync(99);
    expect(workspaceApi.update).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        panes: [
          {
            id: 'workspace-1-pane-1',
            cwd: '/Users/tester/project',
          },
        ],
        updatedAt: now,
      }),
    );
  });

  it('ignores pane cwd updates when the pane is unknown or cwd is unchanged', async () => {
    // Given: a loaded workspace store.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, cwdDebounceMs: 100, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: callers report an unchanged cwd and an unknown pane id.
    useStore.getState().updatePaneCwd('workspace-1-pane-1', '/Users/tester');
    useStore.getState().updatePaneCwd('missing-pane', '/Users/tester/project');
    await vi.advanceTimersByTimeAsync(100);

    // Then: no local mutation or persistence is performed.
    expect(selectActiveWorkspace(useStore.getState())?.updatedAt).toBe(1);
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it('updates pane PTY ids without scheduling persistence', async () => {
    // Given: a loaded workspace store.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: a TerminalView reports its runtime PTY id and later clears it.
    useStore.getState().setPanePtyId('workspace-1-pane-1', 'pty-1');
    expect(selectActivePane(useStore.getState())?.ptyId).toBe('pty-1');
    useStore.getState().setPanePtyId('workspace-1-pane-1', null);
    await vi.advanceTimersByTimeAsync(50);

    // Then: the runtime-only id updates local state without touching persisted workspace data.
    expect(selectActivePane(useStore.getState())?.ptyId).toBeUndefined();
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it('keeps only the latest debounced workspace update for the same workspace', async () => {
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

  it('persists all workspaces when the debounce timer fires', async () => {
    // Given: a store with multiple loaded workspaces.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: multiple workspaces are updated within the debounce window.
    const updatedWorkspace1 = { ...workspace, name: 'Updated 1' };
    const updatedWorkspace2 = { ...workspace2, name: 'Updated 2' };
    useStore.getState().updateWorkspace(updatedWorkspace1);
    now = 3;
    useStore.getState().updateWorkspace(updatedWorkspace2);
    await vi.advanceTimersByTimeAsync(50);

    // Then: both workspaces are persisted during the same flush.
    expect(workspaceApi.update).toHaveBeenCalledTimes(2);
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1', name: 'Updated 1' }),
    );
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-2', name: 'Updated 2' }),
    );
    vi.useRealTimers();
  });

  it('does not persist unchanged workspaces during a debounce flush', async () => {
    // Given: a store with multiple loaded workspaces.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: only one workspace changes before the debounce timer fires.
    useStore.getState().updateWorkspace({ ...workspace, name: 'Updated 1' });
    await vi.advanceTimersByTimeAsync(50);

    // Then: unchanged workspace metadata is not rewritten by main-process update().
    expect(workspaceApi.update).toHaveBeenCalledOnce();
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1', name: 'Updated 1' }),
    );
    expect(workspaceApi.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-2' }),
    );
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
      name: 'tester',
      layout: {
        type: 'leaf',
        paneId: 'pane-2',
      },
      activePaneId: 'pane-2',
    });
    expect(updatedWorkspace?.panes[1]).toEqual({
      id: 'pane-2',
      cwd: '/Users/tester',
    });
  });

  it('opens an SSH host in a new active tab with a quoted initial command', async () => {
    // Given: a loaded workspace with deterministic tab and pane ids.
    vi.useFakeTimers();
    const ids = ['tab-2', 'pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();

    // When: a host alias is opened from the Connections sidebar.
    useStore.getState().openSshHostTab("dev'host");
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());

    // Then: the SSH tab is active and the command is shell-quoted before terminal injection.
    expect(updatedWorkspace?.activeTabId).toBe('tab-2');
    expect(updatedWorkspace?.tabs[1]).toEqual({
      id: 'tab-2',
      name: "dev'host",
      layout: {
        type: 'leaf',
        paneId: 'pane-2',
      },
      activePaneId: 'pane-2',
    });
    expect(updatedWorkspace?.panes[1]).toEqual({
      id: 'pane-2',
      cwd: '/Users/tester',
      // POSIX single-quote escape: close, escape ', reopen.
      initialCommand: "ssh 'dev'\\''host'",
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
          name: 'zsh',
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
        },
      ],
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [secondTabWorkspace], activeWorkspaceId: null }),
    );
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

  it('selects a tab in another workspace and makes that workspace active', async () => {
    // Given: two workspaces are loaded and the second workspace has multiple tabs.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/project');
    const workspace2WithTabs: Workspace = {
      ...workspace2,
      tabs: [
        workspace2.tabs[0],
        {
          id: 'workspace-2-tab-2',
          name: 'server',
          layout: {
            type: 'leaf',
            paneId: 'workspace-2-pane-2',
          },
          activePaneId: 'workspace-2-pane-2',
        },
      ],
      panes: [
        ...workspace2.panes,
        {
          id: 'workspace-2-pane-2',
          cwd: '/Users/tester/project',
        },
      ],
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2WithTabs], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: a sidebar-style action selects a tab in the inactive workspace.
    useStore.getState().selectWorkspaceTab('workspace-2', 'workspace-2-tab-2');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the target workspace and tab are active and the tab choice is persisted.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-2');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        activeTabId: 'workspace-2-tab-2',
      }),
    );
  });

  it('selects the already-active tab of an inactive workspace without persisting', async () => {
    // Given: two workspaces are loaded and the second workspace already has its target tab active.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/project');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: a sidebar-style action selects the already-active tab in the inactive workspace.
    useStore.getState().selectWorkspaceTab('workspace-2', 'workspace-2-tab-1');
    await vi.advanceTimersByTimeAsync(50);

    // Then: only the active workspace changes; no workspace snapshot needs persistence.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-1');
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it('selects a pane in another workspace and persists the target tab pane selection', async () => {
    // Given: an inactive workspace has multiple tabs and panes.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/project');
    const workspace2WithPanes: Workspace = {
      ...workspace2,
      tabs: [
        {
          ...workspace2.tabs[0]!,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              {
                type: 'leaf',
                paneId: 'workspace-2-pane-1',
              },
              {
                type: 'leaf',
                paneId: 'workspace-2-pane-2',
              },
            ],
          },
          activePaneId: 'workspace-2-pane-1',
        },
        {
          id: 'workspace-2-tab-2',
          name: 'logs',
          layout: {
            type: 'leaf',
            paneId: 'workspace-2-pane-3',
          },
          activePaneId: 'workspace-2-pane-3',
        },
      ],
      panes: [
        ...workspace2.panes,
        {
          id: 'workspace-2-pane-2',
          cwd: '/Users/tester/project',
        },
        {
          id: 'workspace-2-pane-3',
          cwd: '/Users/tester/project/logs',
        },
      ],
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2WithPanes], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: a sidebar-style action selects a pane in the inactive workspace.
    useStore
      .getState()
      .selectWorkspacePane('workspace-2', 'workspace-2-tab-2', 'workspace-2-pane-3');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the target workspace, tab, and pane become active and the tab choice is persisted.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-2');
    expect(selectActivePane(useStore.getState())?.id).toBe('workspace-2-pane-3');
    expect(workspaceApi.setActiveWorkspaceId).toHaveBeenCalledWith('workspace-2');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        activeTabId: 'workspace-2-tab-2',
        tabs: expect.arrayContaining([
          expect.objectContaining({
            id: 'workspace-2-tab-2',
            activePaneId: 'workspace-2-pane-3',
          }),
        ]),
      }),
    );
  });

  it('selects a pane in the active tab without switching tabs', async () => {
    // Given: the active tab has two panes and the first is active.
    vi.useFakeTimers();
    const splitWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          ...workspace.tabs[0]!,
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              {
                type: 'leaf',
                paneId: 'workspace-1-pane-1',
              },
              {
                type: 'leaf',
                paneId: 'pane-2',
              },
            ],
          },
          activePaneId: 'workspace-1-pane-1',
        },
      ],
      panes: [
        ...workspace.panes,
        {
          id: 'pane-2',
          cwd: '/Users/tester/project',
        },
      ],
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [splitWorkspace], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the second pane is selected by workspace/tab/pane id.
    useStore.getState().selectWorkspacePane('workspace-1', 'workspace-1-tab-1', 'pane-2');
    await vi.advanceTimersByTimeAsync(50);

    // Then: only the pane selection changes on the current active tab.
    expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-1-tab-1');
    expect(selectActivePane(useStore.getState())?.id).toBe('pane-2');
    expect(workspaceApi.setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            id: 'workspace-1-tab-1',
            activePaneId: 'pane-2',
          }),
        ],
      }),
    );
  });

  it('ignores workspace pane selection when ids are stale or already active', async () => {
    // Given: a loaded workspace store.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: callers provide invalid ids or select the already-active pane.
    useStore.getState().selectWorkspacePane('missing-workspace', 'workspace-1-tab-1', 'pane-1');
    useStore.getState().selectWorkspacePane('workspace-1', 'missing-tab', 'workspace-1-pane-1');
    useStore.getState().selectWorkspacePane('workspace-1', 'workspace-1-tab-1', 'missing-pane');
    useStore
      .getState()
      .selectWorkspacePane('workspace-1', 'workspace-1-tab-1', 'workspace-1-pane-1');
    await vi.advanceTimersByTimeAsync(50);

    // Then: no state mutation or persistence is performed.
    expect(selectActivePane(useStore.getState())?.id).toBe('workspace-1-pane-1');
    expect(workspaceApi.setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it('renames a tab with a trimmed name and ignores blank names', async () => {
    // Given: a workspace has one tab.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the tab is renamed with surrounding whitespace.
    useStore.getState().renameTab('workspace-1-tab-1', '  server  ');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the tab name is trimmed locally and persisted.
    expect(selectActiveTab(useStore.getState())?.name).toBe('server');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            id: 'workspace-1-tab-1',
            name: 'server',
          }),
        ],
      }),
    );

    // When: callers submit a blank title.
    vi.mocked(workspaceApi.update).mockClear();
    useStore.getState().renameTab('workspace-1-tab-1', '   ');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the blank rename is discarded.
    expect(selectActiveTab(useStore.getState())?.name).toBe('server');
    expect(workspaceApi.update).not.toHaveBeenCalled();
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
          name: 'zsh',
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
        },
      ],
      activeTabId: 'workspace-1-tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [secondTabWorkspace], activeWorkspaceId: null }),
    );
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

  it('splits a pane and makes the new pane active', async () => {
    // Given: a loaded workspace with one pane.
    vi.useFakeTimers();
    const ids = ['pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();

    // When: the active pane is split vertically.
    useStore.getState().splitPane('workspace-1-pane-1', 'vertical');

    // Then: the tab layout becomes a split tree and the new pane inherits cwd/title.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs[0]?.activePaneId).toBe('pane-2');
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        {
          type: 'leaf',
          paneId: 'workspace-1-pane-1',
        },
        {
          type: 'leaf',
          paneId: 'pane-2',
        },
      ],
    });
    expect(updatedWorkspace?.panes[1]).toEqual({
      id: 'pane-2',
      cwd: '/Users/tester',
    });
    expect(updatedWorkspace?.updatedAt).toBe(now);
  });

  it('updates active pane, closes a pane, and keeps the final pane open', async () => {
    // Given: the active tab contains two panes.
    vi.useFakeTimers();
    const ids = ['pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    useStore.getState().splitPane('workspace-1-pane-1', 'horizontal');

    // When: focus moves back to the original pane.
    useStore.getState().setActivePane('workspace-1-pane-1');

    // Then: active pane state is persisted on the current tab.
    expect(selectActiveWorkspace(useStore.getState())?.tabs[0]?.activePaneId).toBe(
      'workspace-1-pane-1',
    );

    // When: the inactive pane is closed.
    useStore.getState().closePane('pane-2');

    // Then: the layout collapses to the remaining pane and the final pane cannot be closed.
    let updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'leaf',
      paneId: 'workspace-1-pane-1',
    });
    expect(updatedWorkspace?.tabs[0]?.activePaneId).toBe('workspace-1-pane-1');
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['workspace-1-pane-1']);

    useStore.getState().closePane('workspace-1-pane-1');

    updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'leaf',
      paneId: 'workspace-1-pane-1',
    });
    expect(updatedWorkspace?.panes).toHaveLength(1);
  });

  it('closes a pane without removing panes that belong to other tabs', async () => {
    // Given: the active tab and an inactive tab both have split panes.
    vi.useFakeTimers();
    const multiTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              {
                type: 'leaf',
                paneId: 'pane-1',
              },
              {
                type: 'leaf',
                paneId: 'pane-2',
              },
            ],
          },
          activePaneId: 'pane-1',
        },
        {
          id: 'tab-2',
          name: 'zsh',
          layout: {
            type: 'split',
            direction: 'horizontal',
            ratio: 0.5,
            children: [
              {
                type: 'leaf',
                paneId: 'pane-3',
              },
              {
                type: 'leaf',
                paneId: 'pane-4',
              },
            ],
          },
          activePaneId: 'pane-3',
        },
      ],
      panes: [
        {
          id: 'pane-1',
          cwd: '/Users/tester',
        },
        {
          id: 'pane-2',
          cwd: '/Users/tester',
        },
        {
          id: 'pane-3',
          cwd: '/Users/tester/other',
        },
        {
          id: 'pane-4',
          cwd: '/Users/tester/other',
        },
      ],
      activeTabId: 'tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [multiTabWorkspace], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: a pane in the active tab is closed.
    useStore.getState().closePane('pane-1');

    // Then: only that pane is removed; inactive tab panes remain available.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-2', 'pane-3', 'pane-4']);
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'leaf',
      paneId: 'pane-2',
    });
    expect(updatedWorkspace?.tabs[1]?.layout).toEqual(multiTabWorkspace.tabs[1]?.layout);
  });

  it('closes only the target pane inside a nested split layout', async () => {
    // Given: one tab has three panes where the target pane is inside a nested split.
    vi.useFakeTimers();
    const nestedWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.4,
            children: [
              {
                type: 'split',
                direction: 'horizontal',
                ratio: 0.5,
                children: [
                  {
                    type: 'leaf',
                    paneId: 'pane-1',
                  },
                  {
                    type: 'leaf',
                    paneId: 'pane-2',
                  },
                ],
              },
              {
                type: 'leaf',
                paneId: 'pane-3',
              },
            ],
          },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        {
          id: 'pane-1',
          cwd: '/Users/tester',
        },
        {
          id: 'pane-2',
          cwd: '/Users/tester',
        },
        {
          id: 'pane-3',
          cwd: '/Users/tester',
        },
      ],
      activeTabId: 'tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [nestedWorkspace], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: one pane in the nested split is closed.
    useStore.getState().closePane('pane-2');

    // Then: only that pane is removed and the outer sibling pane remains in the layout.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-1', 'pane-3']);
    expect(updatedWorkspace?.tabs[0]?.activePaneId).toBe('pane-1');
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      children: [
        {
          type: 'leaf',
          paneId: 'pane-1',
        },
        {
          type: 'leaf',
          paneId: 'pane-3',
        },
      ],
    });
  });

  it('updates split ratio by layout path and clamps extreme values', async () => {
    // Given: the active tab contains one split.
    vi.useFakeTimers();
    const ids = ['pane-2'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    useStore.getState().splitPane('workspace-1-pane-1', 'vertical');

    // When: the split ratio is resized below the allowed minimum.
    useStore.getState().resizeSplit([], 0.05);

    // Then: the persisted layout ratio is clamped.
    expect(selectActiveWorkspace(useStore.getState())?.tabs[0]?.layout).toEqual(
      expect.objectContaining({
        ratio: 0.15,
      }),
    );

    // When: it is resized inside the allowed range.
    useStore.getState().resizeSplit([], 0.62);

    // Then: the requested ratio is stored.
    expect(selectActiveWorkspace(useStore.getState())?.tabs[0]?.layout).toEqual(
      expect.objectContaining({
        ratio: 0.62,
      }),
    );
  });

  it('creates a workspace, adds it to the list, and makes it active', async () => {
    // Given: a loaded store and a mock that returns a new workspace.
    const newWorkspace = createWorkspace('workspace-2', '/Users/tester/new');
    workspaceApi.create = vi.fn(() => Promise.resolve(newWorkspace));
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: a new workspace is created.
    await useStore.getState().createWorkspace('new');

    // Then: the store appends the workspace and switches to it.
    expect(workspaceApi.create).toHaveBeenCalledWith('new', '');
    expect(useStore.getState().workspaces).toHaveLength(2);
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
  });

  it('trims the name and falls back to "Workspace" when the name is blank', async () => {
    // Given: a store where create resolves to any workspace.
    const newWorkspace = createWorkspace('workspace-2', '/Users/tester/new');
    workspaceApi.create = vi.fn(() => Promise.resolve(newWorkspace));
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: createWorkspace is called with a blank name.
    await useStore.getState().createWorkspace('   ');

    // Then: the main process receives the default name.
    expect(workspaceApi.create).toHaveBeenCalledWith('Workspace', '');
  });

  it('stores an error when createWorkspace fails', async () => {
    // Given: the workspace API rejects on create.
    workspaceApi.create = vi.fn(() => Promise.reject(new Error('create failed')));
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: creation is attempted.
    await useStore.getState().createWorkspace('new');

    // Then: the error is surfaced and no workspace is added.
    expect(useStore.getState().error).toBe('create failed');
    expect(useStore.getState().workspaces).toHaveLength(1);
  });

  it('deletes a workspace and falls back to the first remaining workspace when active', async () => {
    // Given: two workspaces are loaded and the first is active.
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: the active workspace is deleted.
    await useStore.getState().deleteWorkspace('workspace-1');

    // Then: it is removed and the remaining workspace becomes active.
    expect(workspaceApi.delete).toHaveBeenCalledWith('workspace-1');
    expect(useStore.getState().workspaces).toHaveLength(1);
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
  });

  it('deletes an inactive workspace without changing the active workspace', async () => {
    // Given: two workspaces are loaded and the first is active.
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: the inactive workspace is deleted.
    await useStore.getState().deleteWorkspace('workspace-2');

    // Then: the active workspace stays the same.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
    expect(useStore.getState().workspaces).toHaveLength(1);
  });

  it('does not delete the last remaining workspace', async () => {
    // Given: only one workspace exists.
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: deletion is attempted on the only workspace.
    await useStore.getState().deleteWorkspace('workspace-1');

    // Then: the workspace is preserved and the API is not called.
    expect(workspaceApi.delete).not.toHaveBeenCalled();
    expect(useStore.getState().workspaces).toHaveLength(1);
  });

  it('stores an error when deleteWorkspace fails', async () => {
    // Given: two workspaces are loaded and the API rejects on delete.
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: null }),
    );
    workspaceApi.delete = vi.fn(() => Promise.reject(new Error('delete failed')));
    const useStore = createWorkspaceStore({ workspaceApi });
    await useStore.getState().loadWorkspaces();

    // When: deletion is attempted.
    await useStore.getState().deleteWorkspace('workspace-1');

    // Then: the error is surfaced and the list is unchanged.
    expect(useStore.getState().error).toBe('delete failed');
    expect(useStore.getState().workspaces).toHaveLength(2);
  });

  it('renames a workspace with a trimmed name and ignores blank names', async () => {
    // Given: a loaded workspace.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the workspace is renamed with surrounding whitespace.
    useStore.getState().renameWorkspace('workspace-1', '  Project  ');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the trimmed name is applied and persisted.
    expect(useStore.getState().workspaces[0]?.name).toBe('Project');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1', name: 'Project' }),
    );

    // When: callers submit a blank name.
    vi.mocked(workspaceApi.update).mockClear();
    useStore.getState().renameWorkspace('workspace-1', '   ');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the blank rename is discarded.
    expect(useStore.getState().workspaces[0]?.name).toBe('Project');
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });
});
