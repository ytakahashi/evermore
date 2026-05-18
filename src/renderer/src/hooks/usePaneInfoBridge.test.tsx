import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeInfo, Workspace } from '../../../shared/types';
import { usePaneInfoStore } from '../stores/paneInfoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { usePaneInfoBridge } from './usePaneInfoBridge';

const info: PaneRuntimeInfo = {
  ptyId: 'pty-1',
  processActivity: 'idle',
  foregroundSession: { kind: 'none' },
  integration: {
    shell: false,
    protocols: [],
    lastSequenceAt: 0,
    stale: false,
  },
  observedAt: 1000,
};

function createWorkspaceWithPane(ptyId: string | undefined): Workspace {
  return {
    id: 'workspace-1',
    name: 'Default',
    rootPath: '/Users/tester',
    tabs: [
      {
        id: 'tab-1',
        name: 'zsh',
        layout: { type: 'leaf', paneId: 'pane-1' },
        activePaneId: 'pane-1',
      },
    ],
    panes: [
      {
        id: 'pane-1',
        cwd: '/Users/tester',
        ...(ptyId ? { ptyId } : {}),
      },
    ],
    activeTabId: 'tab-1',
    createdAt: 1,
    updatedAt: 1,
  };
}

function getActivePane(): { cwd: string; ptyId?: string } | undefined {
  return useWorkspaceStore.getState().workspaces[0]?.panes[0];
}

function TestBridge(): React.JSX.Element {
  usePaneInfoBridge();
  return <div>bridge</div>;
}

describe('usePaneInfoBridge', () => {
  let changedCallback: ((info: PaneRuntimeInfo) => void) | null;
  let unsubscribeChanged: ReturnType<typeof vi.fn>;
  let resolveList: ((value: PaneRuntimeInfo[]) => void) | null;
  let listPromise: Promise<PaneRuntimeInfo[]>;

  beforeEach(() => {
    changedCallback = null;
    unsubscribeChanged = vi.fn();
    resolveList = null;
    listPromise = new Promise<PaneRuntimeInfo[]>((resolve) => {
      resolveList = resolve;
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        paneInfo: {
          list: vi.fn(() => listPromise),
          notifyCommand: vi.fn(() => Promise.resolve()),
          onChanged: vi.fn((cb) => {
            changedCallback = cb;
            return unsubscribeChanged;
          }),
        },
      } as unknown as Window['api'],
    });
  });

  afterEach(() => {
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
    Reflect.deleteProperty(window, 'api');
    vi.restoreAllMocks();
  });

  it('loads initial pane info and subscribes to runtime changes', async () => {
    // Given: the bridge component is not yet mounted.

    // When: the bridge mounts and the list resolves.
    render(<TestBridge />);
    resolveList?.([info]);

    // Then: it fetches the initial snapshot and subscribes to changed events.
    await waitFor(() => expect(window.api.paneInfo.list).toHaveBeenCalledOnce());
    expect(window.api.paneInfo.onChanged).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': info }),
    );
  });

  it('mirrors changed callbacks into the pane info store', async () => {
    // Given: the bridge is mounted and the initial list has resolved.
    render(<TestBridge />);
    resolveList?.([info]);
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': info }),
    );

    // When: main-process runtime events arrive through preload subscriptions.
    const runningInfo: PaneRuntimeInfo = {
      ptyId: 'pty-1',
      processActivity: 'running',
      foregroundCommand: 'pnpm dev',
      foregroundSession: { kind: 'other' },
      integration: {
        shell: false,
        protocols: [],
        lastSequenceAt: 0,
        stale: false,
      },
      observedAt: 1001,
    };
    act(() => {
      changedCallback?.(runningInfo);
    });

    // Then: renderer state reflects the update.
    expect(usePaneInfoStore.getState().infosByPtyId['pty-1']).toEqual(runningInfo);
  });

  it('unsubscribes from runtime events on unmount', () => {
    // Given: the bridge has active subscriptions.
    const { unmount } = render(<TestBridge />);

    // When: the component unmounts.
    unmount();

    // Then: the preload subscription is cleaned up.
    expect(unsubscribeChanged).toHaveBeenCalledOnce();
  });

  it('push path: forwards changed-event cwd into the matching workspace pane', async () => {
    // Given: a workspace pane already knows its runtime PTY id.
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane('pty-1')],
      activeWorkspaceId: 'workspace-1',
    });

    // When: the bridge mounts and an onChanged event includes a cwd.
    render(<TestBridge />);
    resolveList?.([]);
    await waitFor(() => expect(window.api.paneInfo.list).toHaveBeenCalledOnce());
    const withCwd: PaneRuntimeInfo = { ...info, cwd: '/Users/tester/project' };
    act(() => {
      changedCallback?.(withCwd);
    });

    // Then: the workspace pane's cwd reflects the push.
    expect(getActivePane()?.cwd).toBe('/Users/tester/project');
  });

  it('push path: does not touch the workspace when info.cwd is undefined', async () => {
    // Given: a workspace pane already knows its runtime PTY id and an initial cwd.
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane('pty-1')],
      activeWorkspaceId: 'workspace-1',
    });
    const initialUpdatedAt = useWorkspaceStore.getState().workspaces[0]!.updatedAt;
    render(<TestBridge />);
    resolveList?.([]);
    await waitFor(() => expect(window.api.paneInfo.list).toHaveBeenCalledOnce());

    // When: an onChanged event arrives without cwd.
    act(() => {
      changedCallback?.(info);
    });

    // Then: the pane cwd and workspace.updatedAt stay at their original values.
    expect(getActivePane()?.cwd).toBe('/Users/tester');
    expect(useWorkspaceStore.getState().workspaces[0]?.updatedAt).toBe(initialUpdatedAt);
  });

  it('pull path A: replays the cached snapshot when a pane first acquires its ptyId', async () => {
    // Given: the bridge has loaded an initial snapshot containing cwd for a PTY id, while the
    // workspace pane is still ptyId-less (PTY creation has not resolved yet on the renderer side).
    const seeded: PaneRuntimeInfo = { ...info, cwd: '/Users/tester/project' };
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane(undefined)],
      activeWorkspaceId: 'workspace-1',
    });
    render(<TestBridge />);
    resolveList?.([seeded]);
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': seeded }),
    );
    // Sanity: pane has not yet been reconciled because it has no ptyId.
    expect(getActivePane()?.cwd).toBe('/Users/tester');

    // When: the pane later acquires its PTY id via setPanePtyId.
    act(() => {
      useWorkspaceStore.getState().setPanePtyId('pane-1', 'pty-1');
    });

    // Then: the cached snapshot is replayed into the workspace pane.
    await waitFor(() => expect(getActivePane()?.cwd).toBe('/Users/tester/project'));
  });

  it('pull path A: does not re-fire when the same ptyId is observed in a later workspace mutation', async () => {
    // The `seenPtyIds` guard is the only thing protecting pull A from re-running on every
    // unrelated workspace mutation. To exercise the guard we mutate the paneInfo snapshot to a
    // *different* cwd after the initial replay, then bump the workspace state without changing
    // pane.ptyId: without the guard, pull A would pick up the new snapshot value and overwrite
    // the pane cwd; with the guard it stays at the originally pulled value. We deliberately use
    // `setInfo` (a direct store mutation) rather than the onChanged callback so the push path is
    // not exercised here and only pull A is under test.

    // Given: the pane has already gone through pull A's first observation.
    const seeded: PaneRuntimeInfo = { ...info, cwd: '/Users/tester/project' };
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane(undefined)],
      activeWorkspaceId: 'workspace-1',
    });
    render(<TestBridge />);
    resolveList?.([seeded]);
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': seeded }),
    );
    act(() => {
      useWorkspaceStore.getState().setPanePtyId('pane-1', 'pty-1');
    });
    await waitFor(() => expect(getActivePane()?.cwd).toBe('/Users/tester/project'));

    // When: the snapshot reports a new cwd via the direct store mutation, and the workspace
    // mutates again with the same ptyId still attached.
    act(() => {
      usePaneInfoStore.getState().setInfo({ ...info, cwd: '/Users/tester/elsewhere' });
    });
    act(() => {
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) => ({ ...workspace, updatedAt: 2 })),
      }));
    });

    // Then: pull A's guard suppresses the replay, so the pane keeps its original cwd.
    expect(getActivePane()?.cwd).toBe('/Users/tester/project');
  });

  it('pull path B: replays the snapshot after loadPaneInfo resolves for an already-known ptyId', async () => {
    // Given: the pane's PTY id is already set before the initial list resolves. loadPaneInfo has
    // not returned yet, so the bridge has nothing to forward through the push path.
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane('pty-1')],
      activeWorkspaceId: 'workspace-1',
    });
    render(<TestBridge />);

    // When: loadPaneInfo resolves with cwd for the existing ptyId.
    const seeded: PaneRuntimeInfo = { ...info, cwd: '/Users/tester/project' };
    resolveList?.([seeded]);

    // Then: the workspace pane picks up the cwd through the post-load reconcile sweep.
    await waitFor(() => expect(getActivePane()?.cwd).toBe('/Users/tester/project'));
  });

  it('pull path B: does not bump updatedAt when the snapshot cwd already matches the pane cwd', async () => {
    // pull B replays every visible ptyId after loadPaneInfo settles. The workspace store's cwd
    // early-return is what keeps a matching cwd from bumping `updatedAt`, but we pin the
    // end-to-end behaviour at the bridge layer because regressions could land in either piece
    // (the helper, the store, or the call site sequencing) and silently double-dirty workspaces.

    // Given: a workspace pane whose cwd already matches what the snapshot will carry.
    useWorkspaceStore.setState({
      workspaces: [createWorkspaceWithPane('pty-1')],
      activeWorkspaceId: 'workspace-1',
    });
    const initialUpdatedAt = useWorkspaceStore.getState().workspaces[0]!.updatedAt;
    render(<TestBridge />);

    // When: loadPaneInfo resolves with the same cwd as the pane already has.
    const seeded: PaneRuntimeInfo = { ...info, cwd: '/Users/tester' };
    resolveList?.([seeded]);
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': seeded }),
    );

    // Then: the workspace stays at its initial updatedAt — pull B's replay is a no-op.
    expect(useWorkspaceStore.getState().workspaces[0]?.updatedAt).toBe(initialUpdatedAt);
  });
});
