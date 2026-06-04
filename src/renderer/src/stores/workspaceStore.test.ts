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

  it('reflects cwd updates keyed by ptyId in the matching pane', async () => {
    // Given: a workspace pane has acquired a runtime PTY id.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({
      workspaceApi,
      cwdDebounceMs: 100,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    useStore.getState().setPanePtyId('workspace-1-pane-1', 'pty-1');

    // When: the bridge reports a new cwd keyed by ptyId.
    useStore.getState().updatePaneCwdByPtyId('pty-1', '/Users/tester/project');

    // Then: the pane's cwd updates immediately and persists after the cwd debounce timer.
    expect(selectActivePane(useStore.getState())?.cwd).toBe('/Users/tester/project');
    await vi.advanceTimersByTimeAsync(100);
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        panes: [
          {
            id: 'workspace-1-pane-1',
            ptyId: 'pty-1',
            cwd: '/Users/tester/project',
          },
        ],
      }),
    );
  });

  it('reflects cwd updates for panes in inactive workspaces', async () => {
    // Given: two workspaces are loaded and the second pane has a runtime PTY id.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({
        workspaces: [workspace, workspace2],
        activeWorkspaceId: 'workspace-1',
      }),
    );
    const useStore = createWorkspaceStore({
      workspaceApi,
      cwdDebounceMs: 100,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    // Pretend the inactive workspace's pane already has a PTY id (every workspace stays mounted).
    useStore.setState((state) => ({
      workspaces: state.workspaces.map((current) =>
        current.id === 'workspace-2'
          ? { ...current, panes: [{ ...current.panes[0]!, ptyId: 'pty-2' }] }
          : current,
      ),
    }));

    // When: a cwd update arrives for the inactive workspace's ptyId.
    useStore.getState().updatePaneCwdByPtyId('pty-2', '/Users/tester/2/sub');

    // Then: the inactive workspace's pane reflects the new cwd and persists.
    const updatedInactive = useStore
      .getState()
      .workspaces.find((current) => current.id === 'workspace-2');
    expect(updatedInactive?.panes[0]?.cwd).toBe('/Users/tester/2/sub');
    await vi.advanceTimersByTimeAsync(100);
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-2' }),
    );
  });

  it('treats unchanged or unknown cwd updates by ptyId as a no-op', async () => {
    // Given: a loaded workspace and a pane that already has its current cwd.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, cwdDebounceMs: 100, now: () => now });
    await useStore.getState().loadWorkspaces();
    useStore.getState().setPanePtyId('workspace-1-pane-1', 'pty-1');

    // When: the bridge reports the same cwd, and a cwd for an unknown ptyId.
    useStore.getState().updatePaneCwdByPtyId('pty-1', '/Users/tester');
    useStore.getState().updatePaneCwdByPtyId('pty-unknown', '/Users/tester/project');
    await vi.advanceTimersByTimeAsync(100);

    // Then: workspace.updatedAt stays at its loaded value and persistence is not scheduled.
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

  it('adds a tab to an inactive workspace and makes that workspace active', async () => {
    // Given: two workspaces are loaded and the first workspace is active.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/project');
    const ids = ['tab-2', 'pane-2'];
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [workspace, workspace2], activeWorkspaceId: 'workspace-1' }),
    );
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();

    // When: a tab is added to the inactive workspace from the sidebar.
    useStore.getState().addWorkspaceTab('workspace-2');
    await vi.advanceTimersByTimeAsync(50);
    const updatedWorkspace = useStore
      .getState()
      .workspaces.find((currentWorkspace) => currentWorkspace.id === 'workspace-2');

    // Then: the new tab is active and the target workspace becomes the active workspace.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(updatedWorkspace?.activeTabId).toBe('tab-2');
    expect(updatedWorkspace?.tabs[1]).toEqual({
      id: 'tab-2',
      name: 'project',
      layout: {
        type: 'leaf',
        paneId: 'pane-2',
      },
      activePaneId: 'pane-2',
    });
    expect(updatedWorkspace?.panes[1]).toEqual({
      id: 'pane-2',
      cwd: '/Users/tester/project',
    });
    expect(workspaceApi.setActiveWorkspaceId).toHaveBeenCalledWith('workspace-2');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        activeTabId: 'tab-2',
      }),
    );
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

  it('renames a tab in a non-active workspace via renameWorkspaceTab', async () => {
    // Given: two workspaces are loaded with workspace-1 active.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/2');
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({
        workspaces: [workspace, workspace2],
        activeWorkspaceId: 'workspace-1',
      }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();
    const inactiveTabId = workspace2.tabs[0]!.id;

    // When: the inactive workspace's tab is renamed.
    useStore.getState().renameWorkspaceTab('workspace-2', inactiveTabId, '  build  ');
    await vi.advanceTimersByTimeAsync(50);

    // Then: the inactive workspace's tab name is updated and persisted (the active workspace is untouched).
    const inactiveWorkspace = useStore
      .getState()
      .workspaces.find((current) => current.id === 'workspace-2');
    expect(inactiveWorkspace?.tabs[0]?.name).toBe('build');
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        tabs: [expect.objectContaining({ id: inactiveTabId, name: 'build' })],
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

  it('closes a tab in an inactive workspace without switching workspaces', async () => {
    // Given: the second workspace has two tabs and the first workspace is active.
    vi.useFakeTimers();
    const workspace2 = createWorkspace('workspace-2', '/Users/tester/project');
    const secondWorkspaceWithTabs: Workspace = {
      ...workspace2,
      tabs: [
        workspace2.tabs[0]!,
        {
          id: 'workspace-2-tab-2',
          name: 'logs',
          layout: {
            type: 'leaf',
            paneId: 'workspace-2-pane-2',
          },
          activePaneId: 'workspace-2-pane-2',
        },
      ],
      panes: [
        workspace2.panes[0]!,
        {
          id: 'workspace-2-pane-2',
          cwd: '/Users/tester/project/logs',
        },
      ],
      activeTabId: 'workspace-2-tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({
        workspaces: [workspace, secondWorkspaceWithTabs],
        activeWorkspaceId: 'workspace-1',
      }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the inactive workspace's active tab is closed by workspace/tab id.
    useStore.getState().closeWorkspaceTab('workspace-2', 'workspace-2-tab-1');
    await vi.advanceTimersByTimeAsync(50);
    const updatedWorkspace = useStore
      .getState()
      .workspaces.find((currentWorkspace) => currentWorkspace.id === 'workspace-2');

    // Then: that workspace selects its remaining tab while the app stays on workspace-1.
    expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
    expect(updatedWorkspace?.activeTabId).toBe('workspace-2-tab-2');
    expect(updatedWorkspace?.tabs.map((tab) => tab.id)).toEqual(['workspace-2-tab-2']);
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['workspace-2-pane-2']);
    expect(workspaceApi.setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(workspaceApi.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        activeTabId: 'workspace-2-tab-2',
      }),
    );
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

  it('closePaneOnExit removes a non-final pane like closePane does', async () => {
    // Given: the active tab contains two panes (one split).
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

    // When: a non-final pane's PTY exits.
    useStore.getState().closePaneOnExit('pane-2');

    // Then: the layout collapses just like a manual close would.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs).toHaveLength(1);
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({
      type: 'leaf',
      paneId: 'workspace-1-pane-1',
    });
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['workspace-1-pane-1']);
  });

  it('closePaneOnExit closes the tab when the exiting pane is the last one in a multi-tab workspace', async () => {
    // Given: a workspace with two tabs, the active tab holding a single pane.
    vi.useFakeTimers();
    const multiTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-1' },
          activePaneId: 'pane-1',
        },
        {
          id: 'tab-2',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-2' },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester' },
        { id: 'pane-2', cwd: '/Users/tester/other' },
      ],
      activeTabId: 'tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [multiTabWorkspace], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the only pane in the active tab exits.
    useStore.getState().closePaneOnExit('pane-1');

    // Then: the active tab is removed, leaving the other tab and its pane intact.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs.map((tab) => tab.id)).toEqual(['tab-2']);
    expect(updatedWorkspace?.activeTabId).toBe('tab-2');
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-2']);
  });

  it('closePaneOnExit closes the inactive tab when the exiting pane is the last one in that tab', async () => {
    // Given: a workspace with two tabs, where tab-1 is active but the exiting pane-2 is in the inactive tab-2.
    vi.useFakeTimers();
    const multiTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-1' },
          activePaneId: 'pane-1',
        },
        {
          id: 'tab-2',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-2' },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester' },
        { id: 'pane-2', cwd: '/Users/tester/other' },
      ],
      activeTabId: 'tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [multiTabWorkspace], activeWorkspaceId: null }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the only pane in the inactive tab exits.
    useStore.getState().closePaneOnExit('pane-2');

    // Then: the inactive tab is removed, leaving the active tab intact.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs.map((tab) => tab.id)).toEqual(['tab-1']);
    expect(updatedWorkspace?.activeTabId).toBe('tab-1');
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-1']);
  });

  it('closePaneOnExit removes a non-final pane in an inactive tab like closePane does', async () => {
    // Given: tab-1 is active. tab-2 contains two panes (one split).
    vi.useFakeTimers();
    const ids = ['pane-3'];
    const useStore = createWorkspaceStore({
      createId: () => ids.shift() ?? 'fallback-id',
      workspaceApi,
      debounceMs: 50,
      now: () => now,
    });
    await useStore.getState().loadWorkspaces();
    const multiTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-1' },
          activePaneId: 'pane-1',
        },
        {
          id: 'tab-2',
          name: 'zsh',
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'pane-2' },
              { type: 'leaf', paneId: 'pane-3' },
            ],
          },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester' },
        { id: 'pane-2', cwd: '/Users/tester/other2' },
        { id: 'pane-3', cwd: '/Users/tester/other3' },
      ],
      activeTabId: 'tab-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({ workspaces: [multiTabWorkspace], activeWorkspaceId: null }),
    );
    await useStore.getState().loadWorkspaces();

    // When: a non-final pane in the inactive tab exits.
    useStore.getState().closePaneOnExit('pane-3');

    // Then: that pane is removed from the inactive tab, leaving the active tab and the other pane in the inactive tab intact.
    const updatedWorkspace = selectActiveWorkspace(useStore.getState());
    expect(updatedWorkspace?.tabs).toHaveLength(2);
    expect(updatedWorkspace?.tabs[1]?.layout).toEqual({
      type: 'leaf',
      paneId: 'pane-2',
    });
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-1', 'pane-2']);
  });

  it('closePaneOnExit closes the tab inside an inactive workspace when the exiting pane is the last one in that tab', async () => {
    // Given: two workspaces exist. workspace-1 is active. workspace-2 is inactive and contains two tabs.
    vi.useFakeTimers();
    const activeWorkspace: Workspace = {
      ...workspace,
      id: 'workspace-1',
      tabs: [
        {
          id: 'tab-1-1',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-1-1' },
          activePaneId: 'pane-1-1',
        },
      ],
      panes: [{ id: 'pane-1-1', cwd: '/Users/tester/1' }],
      activeTabId: 'tab-1-1',
    };
    const inactiveWorkspace: Workspace = {
      ...workspace,
      id: 'workspace-2',
      tabs: [
        {
          id: 'tab-2-1',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-2-1' },
          activePaneId: 'pane-2-1',
        },
        {
          id: 'tab-2-2',
          name: 'zsh',
          layout: { type: 'leaf', paneId: 'pane-2-2' },
          activePaneId: 'pane-2-2',
        },
      ],
      panes: [
        { id: 'pane-2-1', cwd: '/Users/tester/2-1' },
        { id: 'pane-2-2', cwd: '/Users/tester/2-2' },
      ],
      activeTabId: 'tab-2-1',
    };
    workspaceApi.list = vi.fn(() =>
      Promise.resolve({
        workspaces: [activeWorkspace, inactiveWorkspace],
        activeWorkspaceId: 'workspace-1',
      }),
    );
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();

    // When: the only pane in the inactive workspace's inactive tab exits.
    useStore.getState().closePaneOnExit('pane-2-2');

    // Then: the inactive workspace's target tab is removed, active workspace is untouched.
    const ws1 = useStore.getState().workspaces.find((ws) => ws.id === 'workspace-1');
    const ws2 = useStore.getState().workspaces.find((ws) => ws.id === 'workspace-2');
    expect(ws1?.tabs.map((tab) => tab.id)).toEqual(['tab-1-1']);
    expect(ws2?.tabs.map((tab) => tab.id)).toEqual(['tab-2-1']);
    expect(ws2?.panes.map((pane) => pane.id)).toEqual(['pane-2-1']);
  });

  it('closePaneOnExit leaves the workspace untouched when the last pane of the last tab exits', async () => {
    // Given: a workspace with exactly one tab and one pane.
    vi.useFakeTimers();
    const useStore = createWorkspaceStore({ workspaceApi, debounceMs: 50, now: () => now });
    await useStore.getState().loadWorkspaces();
    const before = selectActiveWorkspace(useStore.getState());

    // When: that single pane's PTY exits.
    useStore.getState().closePaneOnExit('workspace-1-pane-1');

    // Then: nothing changes — the empty workspace would otherwise have no pane to show.
    const after = selectActiveWorkspace(useStore.getState());
    expect(after?.tabs).toHaveLength(1);
    expect(after?.tabs[0]?.layout).toEqual(before?.tabs[0]?.layout);
    expect(after?.panes.map((pane) => pane.id)).toEqual(['workspace-1-pane-1']);
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

  describe('shortcut-dispatched actions', () => {
    it('selectAdjacentTab cycles forward and wraps at the end', async () => {
      // Given: a workspace with three tabs and the first tab active.
      const multiTabWorkspace: Workspace = {
        ...workspace,
        tabs: [
          {
            id: 'tab-a',
            name: 'a',
            layout: { type: 'leaf', paneId: 'pane-a' },
            activePaneId: 'pane-a',
          },
          {
            id: 'tab-b',
            name: 'b',
            layout: { type: 'leaf', paneId: 'pane-b' },
            activePaneId: 'pane-b',
          },
          {
            id: 'tab-c',
            name: 'c',
            layout: { type: 'leaf', paneId: 'pane-c' },
            activePaneId: 'pane-c',
          },
        ],
        panes: [
          { id: 'pane-a', cwd: '/a' },
          { id: 'pane-b', cwd: '/b' },
          { id: 'pane-c', cwd: '/c' },
        ],
        activeTabId: 'tab-a',
      };
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({ workspaces: [multiTabWorkspace], activeWorkspaceId: 'workspace-1' }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: the user invokes next-tab three times.
      useStore.getState().selectAdjacentTab('next');
      expect(selectActiveTab(useStore.getState())?.id).toBe('tab-b');
      useStore.getState().selectAdjacentTab('next');
      expect(selectActiveTab(useStore.getState())?.id).toBe('tab-c');
      useStore.getState().selectAdjacentTab('next');

      // Then: the third invocation wraps back to the first tab.
      expect(selectActiveTab(useStore.getState())?.id).toBe('tab-a');
    });

    it('selectAdjacentTab cycles backward and wraps at the start', async () => {
      // Given: a workspace with two tabs and the first tab active.
      const twoTabWorkspace: Workspace = {
        ...workspace,
        tabs: [
          {
            id: 'tab-a',
            name: 'a',
            layout: { type: 'leaf', paneId: 'pane-a' },
            activePaneId: 'pane-a',
          },
          {
            id: 'tab-b',
            name: 'b',
            layout: { type: 'leaf', paneId: 'pane-b' },
            activePaneId: 'pane-b',
          },
        ],
        panes: [
          { id: 'pane-a', cwd: '/a' },
          { id: 'pane-b', cwd: '/b' },
        ],
        activeTabId: 'tab-a',
      };
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({ workspaces: [twoTabWorkspace], activeWorkspaceId: 'workspace-1' }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: the user invokes previous-tab from the first tab.
      useStore.getState().selectAdjacentTab('previous');

      // Then: it wraps to the last tab.
      expect(selectActiveTab(useStore.getState())?.id).toBe('tab-b');
    });

    it('selectAdjacentTab is a no-op when the workspace has only one tab', async () => {
      // Given: the default single-tab workspace.
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: shortcut-dispatched next-tab fires.
      useStore.getState().selectAdjacentTab('next');

      // Then: nothing changes.
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-1-tab-1');
    });

    it('selectAdjacentTabGlobal crosses into the next workspace when at the end of the current one', async () => {
      // Given: two single-tab workspaces with the first workspace active.
      const workspaceA = createWorkspace('workspace-1', '/a');
      const workspaceB = createWorkspace('workspace-2', '/b');
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({
          workspaces: [workspaceA, workspaceB],
          activeWorkspaceId: 'workspace-1',
        }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: the user invokes global next-tab from the only tab of the first workspace.
      useStore.getState().selectAdjacentTabGlobal('next');

      // Then: the active workspace switches and lands on the next workspace's first tab.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-1');
    });

    it('selectAdjacentTabGlobal wraps from the last workspace back to the first', async () => {
      // Given: two single-tab workspaces with the second workspace active.
      const workspaceA = createWorkspace('workspace-1', '/a');
      const workspaceB = createWorkspace('workspace-2', '/b');
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({
          workspaces: [workspaceA, workspaceB],
          activeWorkspaceId: 'workspace-2',
        }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: the user invokes global next-tab from the last tab of the last workspace.
      useStore.getState().selectAdjacentTabGlobal('next');

      // Then: it wraps to the first workspace's first tab.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-1-tab-1');
    });

    it('selectAdjacentTabGlobal previous wraps from the first workspace to the last', async () => {
      // Given: two single-tab workspaces with the first workspace active.
      const workspaceA = createWorkspace('workspace-1', '/a');
      const workspaceB = createWorkspace('workspace-2', '/b');
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({
          workspaces: [workspaceA, workspaceB],
          activeWorkspaceId: 'workspace-1',
        }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: the user invokes global previous-tab from the first tab of the first workspace.
      useStore.getState().selectAdjacentTabGlobal('previous');

      // Then: it wraps backward to the last tab of the last workspace.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-1');
    });

    it('selectAdjacentTabGlobal moves between tabs of the same workspace before crossing', async () => {
      // Given: a workspace with two tabs followed by a second single-tab workspace.
      const workspaceA: Workspace = {
        ...createWorkspace('workspace-1', '/a'),
        tabs: [
          {
            id: 'tab-a1',
            name: 'a1',
            layout: { type: 'leaf', paneId: 'pane-a1' },
            activePaneId: 'pane-a1',
          },
          {
            id: 'tab-a2',
            name: 'a2',
            layout: { type: 'leaf', paneId: 'pane-a2' },
            activePaneId: 'pane-a2',
          },
        ],
        panes: [
          { id: 'pane-a1', cwd: '/a' },
          { id: 'pane-a2', cwd: '/a' },
        ],
        activeTabId: 'tab-a1',
      };
      const workspaceB = createWorkspace('workspace-2', '/b');
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({
          workspaces: [workspaceA, workspaceB],
          activeWorkspaceId: 'workspace-1',
        }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: global next-tab fires twice.
      useStore.getState().selectAdjacentTabGlobal('next');

      // Then: the first invocation moves within workspace A.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
      expect(selectActiveTab(useStore.getState())?.id).toBe('tab-a2');

      // When: the user invokes global next-tab again.
      useStore.getState().selectAdjacentTabGlobal('next');

      // Then: it crosses into workspace B.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-2');
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-2-tab-1');
    });

    it('selectAdjacentTabGlobal is a no-op when only one tab exists across all workspaces', async () => {
      // Given: the default single-workspace single-tab fixture.
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: shortcut-dispatched global next-tab fires.
      useStore.getState().selectAdjacentTabGlobal('next');

      // Then: nothing changes.
      expect(useStore.getState().activeWorkspaceId).toBe('workspace-1');
      expect(selectActiveTab(useStore.getState())?.id).toBe('workspace-1-tab-1');
    });

    it('splitActivePane resolves the active pane and delegates to splitPane', async () => {
      // Given: a loaded workspace with a single pane.
      const ids = ['pane-2'];
      const useStore = createWorkspaceStore({
        createId: () => ids.shift() ?? 'fallback-id',
        workspaceApi,
      });
      await useStore.getState().loadWorkspaces();

      // When: the menu-driven action splits the active pane.
      useStore.getState().splitActivePane('vertical');

      // Then: the active tab gains a split layout and the new pane is selected.
      const updatedTab = selectActiveTab(useStore.getState());
      expect(updatedTab?.activePaneId).toBe('pane-2');
      expect(updatedTab?.layout).toEqual({
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'leaf', paneId: 'workspace-1-pane-1' },
          { type: 'leaf', paneId: 'pane-2' },
        ],
      });
    });

    it('closeActiveTab is a no-op when only one tab remains', async () => {
      // Given: the default single-tab workspace.
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();
      const beforeTabCount = selectActiveWorkspace(useStore.getState())?.tabs.length ?? 0;

      // When: shortcut-dispatched close-tab fires.
      useStore.getState().closeActiveTab();

      // Then: the workspace keeps its tab.
      expect(selectActiveWorkspace(useStore.getState())?.tabs.length).toBe(beforeTabCount);
    });

    it('closeActiveTab closes the active tab when more than one exists', async () => {
      // Given: a two-tab workspace with the second tab active.
      const twoTabWorkspace: Workspace = {
        ...workspace,
        tabs: [
          {
            id: 'tab-a',
            name: 'a',
            layout: { type: 'leaf', paneId: 'pane-a' },
            activePaneId: 'pane-a',
          },
          {
            id: 'tab-b',
            name: 'b',
            layout: { type: 'leaf', paneId: 'pane-b' },
            activePaneId: 'pane-b',
          },
        ],
        panes: [
          { id: 'pane-a', cwd: '/a' },
          { id: 'pane-b', cwd: '/b' },
        ],
        activeTabId: 'tab-b',
      };
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({ workspaces: [twoTabWorkspace], activeWorkspaceId: 'workspace-1' }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: shortcut-dispatched close-tab fires.
      useStore.getState().closeActiveTab();

      // Then: only tab-a remains, and the active tab id falls back to it.
      const updated = selectActiveWorkspace(useStore.getState());
      expect(updated?.tabs.map((tab) => tab.id)).toEqual(['tab-a']);
      expect(updated?.activeTabId).toBe('tab-a');
    });

    it('focusAdjacentPane moves to the directly adjacent pane after a vertical split', async () => {
      // Given: a workspace whose active tab is vertically split into left (active) and right.
      const ids = ['pane-2'];
      const useStore = createWorkspaceStore({
        createId: () => ids.shift() ?? 'fallback-id',
        workspaceApi,
      });
      await useStore.getState().loadWorkspaces();
      useStore.getState().splitPane('workspace-1-pane-1', 'vertical');
      // splitPane sets the new pane (right side) active; move focus back to the left pane first.
      useStore.getState().setActivePane('workspace-1-pane-1');

      // When: shortcut-dispatched focus-right fires.
      useStore.getState().focusAdjacentPane('right');

      // Then: the right pane becomes active.
      expect(selectActiveTab(useStore.getState())?.activePaneId).toBe('pane-2');

      // When: shortcut-dispatched focus-left fires.
      useStore.getState().focusAdjacentPane('left');

      // Then: focus returns to the left pane.
      expect(selectActiveTab(useStore.getState())?.activePaneId).toBe('workspace-1-pane-1');
    });

    it('focusAdjacentPane prefers the candidate with the largest perpendicular overlap', async () => {
      // Given: a nested layout where the active (left) pane faces two right-side candidates of
      // unequal vertical extent — the larger candidate must win.
      //   layout: vertical split, left = active pane, right = horizontal split with two stacked panes
      //   The selection rule should pick the top-right pane because the active pane spans the full
      //   height; the largest overlap is with the top-right one when we artificially make it taller.
      const nestedWorkspace: Workspace = {
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
                { type: 'leaf', paneId: 'left' },
                {
                  type: 'split',
                  direction: 'horizontal',
                  // Top child occupies 80% of the right column — that's the larger overlap with
                  // the full-height left pane.
                  ratio: 0.8,
                  children: [
                    { type: 'leaf', paneId: 'right-top' },
                    { type: 'leaf', paneId: 'right-bottom' },
                  ],
                },
              ],
            },
            activePaneId: 'left',
          },
        ],
        panes: [
          { id: 'left', cwd: '/a' },
          { id: 'right-top', cwd: '/b' },
          { id: 'right-bottom', cwd: '/c' },
        ],
        activeTabId: 'tab-1',
      };
      workspaceApi.list = vi.fn(() =>
        Promise.resolve({ workspaces: [nestedWorkspace], activeWorkspaceId: 'workspace-1' }),
      );
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();

      // When: focus-right fires from the left pane.
      useStore.getState().focusAdjacentPane('right');

      // Then: right-top wins because its vertical overlap with the left pane is the largest.
      expect(selectActiveTab(useStore.getState())?.activePaneId).toBe('right-top');
    });

    it('focusAdjacentPane is a no-op when no candidate touches the active edge', async () => {
      // Given: a single-pane workspace (no neighbors at all).
      const useStore = createWorkspaceStore({ workspaceApi });
      await useStore.getState().loadWorkspaces();
      const beforeActive = selectActivePane(useStore.getState())?.id;

      // When: focus-down fires with no neighbor below.
      useStore.getState().focusAdjacentPane('down');

      // Then: the active pane is unchanged (no wrap).
      expect(selectActivePane(useStore.getState())?.id).toBe(beforeActive);
    });

    it('focusAdjacentPane navigates vertically after a horizontal split', async () => {
      // Given: the workspace has been split horizontally (top / bottom) with the top pane active.
      const ids = ['pane-2'];
      const useStore = createWorkspaceStore({
        createId: () => ids.shift() ?? 'fallback-id',
        workspaceApi,
      });
      await useStore.getState().loadWorkspaces();
      useStore.getState().splitPane('workspace-1-pane-1', 'horizontal');
      useStore.getState().setActivePane('workspace-1-pane-1');

      // When: focus-down fires.
      useStore.getState().focusAdjacentPane('down');

      // Then: the bottom pane becomes active.
      expect(selectActiveTab(useStore.getState())?.activePaneId).toBe('pane-2');

      // When: focus-up fires.
      useStore.getState().focusAdjacentPane('up');

      // Then: focus returns to the top pane.
      expect(selectActiveTab(useStore.getState())?.activePaneId).toBe('workspace-1-pane-1');
    });
  });
});
