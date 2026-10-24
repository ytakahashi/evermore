import { describe, expect, it, vi } from 'vite-plus/test';
import type { ConfirmMode, PaneRuntimeInfo, Workspace } from '../../../shared/types';
import { createWorkspaceCloseRequester } from './workspaceClose';

function fixture(mode: ConfirmMode = 'running-only'): {
  request: (workspaceId: string) => Promise<void>;
  confirm: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  closeWorkspace: ReturnType<typeof vi.fn>;
  setEntries: (next: Workspace[]) => void;
  getEntries: () => Workspace[];
  clearInfos: () => void;
} {
  let entries: Workspace[] = [
    {
      id: 'project',
      name: 'Project',
      kind: 'project',
      isOpen: true,
      rootPath: '/project',
      tabs: [],
      panes: [
        { id: 'idle', cwd: '/project', ptyId: 'idle' },
        { id: 'running', cwd: '/project/sub', ptyId: 'running' },
      ],
      activeTabId: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ];
  let infos: Record<string, PaneRuntimeInfo> = {
    running: {
      ptyId: 'running',
      processActivity: 'running',
      foregroundSession: { kind: 'other' },
      integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
      observedAt: 0,
    },
  };
  const closeWorkspace = vi.fn();
  const confirm = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  return {
    request: createWorkspaceCloseRequester({
      confirmCloseWorkspace: confirm,
      getMode: () => mode,
      getPaneInfos: () => infos,
      getWorkspaceState: () => ({ workspaces: entries, closeWorkspace }),
    }),
    confirm,
    closeWorkspace,
    setEntries: (next: Workspace[]) => {
      entries = next;
    },
    getEntries: () => entries,
    clearInfos: () => {
      infos = {};
    },
  };
}

describe('workspace close requester', () => {
  it.each(['never', 'always', 'running-only'] as const)(
    'uses %s policy across all panes',
    async (mode) => {
      // Given: a running pane in a workspace alongside an idle pane.
      const f = fixture(mode);
      // When: the entire workspace is closed.
      const closing = f.request('project');
      if (mode === 'never') expect(f.closeWorkspace).toHaveBeenCalledWith('project');
      await closing;
      // Then: at most one sheet protects every pane.
      expect(f.closeWorkspace).toHaveBeenCalledExactlyOnceWith('project');
      expect(f.confirm).toHaveBeenCalledTimes(mode === 'never' ? 0 : 1);
      if (mode !== 'never') expect(f.confirm).toHaveBeenCalledWith({ runningProcesses: true });
    },
  );

  it.each(['home', 'closed', 'missing'])('refuses %s workspaces', async (kind) => {
    // Given: a protected or unavailable target.
    const f = fixture('always');
    f.setEntries(
      kind === 'missing'
        ? []
        : f.getEntries().map((w) => ({
            ...w,
            kind: kind === 'home' ? 'home' : 'project',
            isOpen: kind !== 'closed',
          })),
    );
    // When: close is requested.
    await f.request('project');
    // Then: no confirmation or mutation occurs.
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.closeWorkspace).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'reject'])('preserves sessions on %s and allows retry', async (result) => {
    // Given: a native sheet that cannot authorize closing.
    const f = fixture();
    if (result === 'cancel') f.confirm.mockResolvedValueOnce(false);
    else f.confirm.mockRejectedValueOnce(new Error('unavailable'));
    // When: the request settles and the user retries.
    await f.request('project');
    expect(f.closeWorkspace).not.toHaveBeenCalled();
    await f.request('project');
    // Then: the guard was released and the new confirmation can close.
    expect(f.confirm).toHaveBeenCalledTimes(2);
    expect(f.closeWorkspace).toHaveBeenCalledOnce();
  });

  it('keeps the pending sheet in charge when runtime becomes idle', async () => {
    // Given: a pending confirmation for a running process.
    const f = fixture();
    let finish!: (value: boolean) => void;
    f.confirm.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.request('project');
    // When: activity disappears and a duplicate close arrives.
    f.clearInfos();
    await f.request('project');
    expect(f.closeWorkspace).not.toHaveBeenCalled();
    finish(true);
    await first;
    // Then: only the original authorization closes the workspace.
    expect(f.confirm).toHaveBeenCalledOnce();
    expect(f.closeWorkspace).toHaveBeenCalledOnce();
  });

  it('does not close a target removed while the native sheet is pending', async () => {
    // Given: confirmation yields while the target is removed.
    const f = fixture();
    f.confirm.mockImplementation(async () => {
      f.setEntries([]);
      return true;
    });
    // When: the confirmation succeeds.
    await f.request('project');
    // Then: latest structural state wins.
    expect(f.closeWorkspace).not.toHaveBeenCalled();
  });
});
