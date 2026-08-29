import { describe, expect, it, vi } from 'vitest';
import type { ConfirmMode, PaneRuntimeInfo, Workspace } from '../../../shared/types';
import {
  createTabCloseRequester,
  hasRunningPty,
  shouldConfirmTabClose,
  type TabCloseRequesterDeps,
} from './tabClose';

function paneInfo(ptyId: string, processActivity: 'idle' | 'running'): PaneRuntimeInfo {
  return {
    ptyId,
    processActivity,
    foregroundSession: { kind: 'none' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    observedAt: 1,
  };
}

function workspace(tabCount = 2): Workspace {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    rootPath: '/tmp/workspace',
    activeTabId: 'tab-1',
    createdAt: 1,
    updatedAt: 1,
    tabs: Array.from({ length: tabCount }, (_, index) => ({
      id: `tab-${index + 1}`,
      name: `Tab ${index + 1}`,
      isCustomName: false,
      activePaneId: `pane-${index + 1}`,
      layout: { type: 'leaf' as const, paneId: `pane-${index + 1}` },
    })),
    panes: Array.from({ length: tabCount }, (_, index) => ({
      id: `pane-${index + 1}`,
      cwd: '/tmp/workspace',
      ptyId: `pty-${index + 1}`,
    })),
  };
}

describe('tab-close policy', () => {
  it.each<{
    expected: boolean;
    label: string;
    mode: ConfirmMode;
    runningProcesses: boolean;
  }>([
    {
      label: 'never with running PTY',
      mode: 'never',
      runningProcesses: true,
      expected: false,
    },
    {
      label: 'always with no running PTY',
      mode: 'always',
      runningProcesses: false,
      expected: true,
    },
    {
      label: 'running-only with running PTY',
      mode: 'running-only',
      runningProcesses: true,
      expected: true,
    },
    {
      label: 'running-only with idle PTY',
      mode: 'running-only',
      runningProcesses: false,
      expected: false,
    },
  ])('evaluates $label', ({ expected, mode, runningProcesses }) => {
    // Given: a confirmation mode and the already-resolved activity state.

    // When: the close policy is evaluated.
    const result = shouldConfirmTabClose({ mode, runningProcesses });

    // Then: only the configured activity condition requires a prompt.
    expect(result).toBe(expected);
  });

  it('reports whether any PTY is running', () => {
    // Given: idle, missing, and running PTY entries.
    const infos = {
      'pty-idle': paneInfo('pty-idle', 'idle'),
      'pty-running': paneInfo('pty-running', 'running'),
    };

    // When / Then: one running entry is sufficient; unassigned and missing entries are ignored.
    expect(hasRunningPty(['pty-idle', undefined, 'pty-running'], infos)).toBe(true);
    expect(hasRunningPty(['pty-idle', undefined, 'pty-missing'], infos)).toBe(false);
  });
});

describe('createTabCloseRequester', () => {
  function createFixture(
    options: {
      confirm?: () => Promise<boolean>;
      infos?: Record<string, PaneRuntimeInfo>;
      mode?: ConfirmMode;
      tabCount?: number;
    } = {},
  ): {
    closeWorkspaceTab: ReturnType<typeof vi.fn>;
    confirmCloseTab: ReturnType<typeof vi.fn>;
    deps: TabCloseRequesterDeps;
    setWorkspaces: (workspaces: Workspace[]) => void;
  } {
    let workspaces = [workspace(options.tabCount)];
    const closeWorkspaceTab = vi.fn();
    const confirmCloseTab = vi.fn(options.confirm ?? (() => Promise.resolve(true)));
    return {
      closeWorkspaceTab,
      confirmCloseTab,
      deps: {
        confirmCloseTab,
        getMode: () => options.mode ?? 'running-only',
        getPaneInfos: () => options.infos ?? {},
        getWorkspaceState: () => ({ workspaces, closeWorkspaceTab }),
      },
      setWorkspaces: (next) => {
        workspaces = next;
      },
    };
  }

  it('closes synchronously without IPC when confirmation is unnecessary', () => {
    // Given: an idle tab under running-only policy.
    const fixture = createFixture({
      infos: { 'pty-1': paneInfo('pty-1', 'idle') },
    });
    const requestClose = createTabCloseRequester(fixture.deps);

    // When: closing is requested without awaiting the returned promise.
    void requestClose('workspace-1', 'tab-1');

    // Then: the primitive runs immediately and native IPC is skipped.
    expect(fixture.closeWorkspaceTab).toHaveBeenCalledWith('workspace-1', 'tab-1');
    expect(fixture.confirmCloseTab).not.toHaveBeenCalled();
  });

  it.each([
    ['confirmed', true, 1],
    ['cancelled', false, 0],
  ])('handles a %s native response', async (_label, confirmed, expectedCloseCount) => {
    // Given: a running PTY whose policy requires confirmation.
    const fixture = createFixture({
      confirm: () => Promise.resolve(confirmed),
      infos: { 'pty-1': paneInfo('pty-1', 'running') },
    });
    const requestClose = createTabCloseRequester(fixture.deps);

    // When: closing is requested.
    await requestClose('workspace-1', 'tab-1');

    // Then: only explicit confirmation reaches the close primitive.
    expect(fixture.confirmCloseTab).toHaveBeenCalledWith({ runningProcesses: true });
    expect(fixture.closeWorkspaceTab).toHaveBeenCalledTimes(expectedCloseCount);
  });

  it('uses generic dialog copy for always mode without running PTYs', async () => {
    // Given: always mode and an idle terminal.
    const fixture = createFixture({
      mode: 'always',
      infos: { 'pty-1': paneInfo('pty-1', 'idle') },
    });

    // When: the close is confirmed.
    await createTabCloseRequester(fixture.deps)('workspace-1', 'tab-1');

    // Then: IPC is told that no process-specific warning is needed.
    expect(fixture.confirmCloseTab).toHaveBeenCalledWith({ runningProcesses: false });
    expect(fixture.closeWorkspaceTab).toHaveBeenCalledOnce();
  });

  it('does not prompt or close the final tab or an unknown target', async () => {
    // Given: a workspace with only its required final tab.
    const fixture = createFixture({
      infos: { 'pty-1': paneInfo('pty-1', 'running') },
      tabCount: 1,
    });
    const requestClose = createTabCloseRequester(fixture.deps);

    // When: final and unknown tabs are requested.
    await requestClose('workspace-1', 'tab-1');
    await requestClose('workspace-1', 'missing');
    await requestClose('missing', 'tab-1');

    // Then: neither confirmation nor mutation occurs.
    expect(fixture.confirmCloseTab).not.toHaveBeenCalled();
    expect(fixture.closeWorkspaceTab).not.toHaveBeenCalled();
  });

  it('revalidates the target after confirmation', async () => {
    // Given: confirmation removes the target before resolving.
    const fixture = createFixture({
      infos: { 'pty-1': paneInfo('pty-1', 'running') },
    });
    fixture.confirmCloseTab.mockImplementation(async () => {
      fixture.setWorkspaces([workspace(1)]);
      return true;
    });

    // When: the dialog resolves after structural state changed.
    await createTabCloseRequester(fixture.deps)('workspace-1', 'tab-1');

    // Then: the stale destructive operation is discarded.
    expect(fixture.closeWorkspaceTab).not.toHaveBeenCalled();
  });

  it('suppresses duplicate requests for the same tab', async () => {
    // Given: a confirmation that remains pending.
    let resolveConfirmation: ((confirmed: boolean) => void) | undefined;
    const fixture = createFixture({
      confirm: () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
        }),
      infos: { 'pty-1': paneInfo('pty-1', 'running') },
    });
    const requestClose = createTabCloseRequester(fixture.deps);

    // When: activity becomes idle and the same tab receives another request before confirmation.
    const first = requestClose('workspace-1', 'tab-1');
    fixture.deps.getPaneInfos = () => ({ 'pty-1': paneInfo('pty-1', 'idle') });
    const duplicate = requestClose('workspace-1', 'tab-1');
    await duplicate;

    // Then: the changed policy input cannot bypass the prompt that already owns the tab.
    expect(fixture.confirmCloseTab).toHaveBeenCalledOnce();
    expect(fixture.closeWorkspaceTab).not.toHaveBeenCalled();
    resolveConfirmation?.(true);
    await first;

    // Then: the original confirmation alone authorizes one close.
    expect(fixture.closeWorkspaceTab).toHaveBeenCalledOnce();
  });

  it('keeps the tab open when confirmation IPC rejects and permits a retry', async () => {
    // Given: the first native request fails and the second succeeds.
    const fixture = createFixture({
      infos: { 'pty-1': paneInfo('pty-1', 'running') },
    });
    fixture.confirmCloseTab
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValueOnce(true);
    const requestClose = createTabCloseRequester(fixture.deps);

    // When: the user retries after the failure.
    await requestClose('workspace-1', 'tab-1');
    await requestClose('workspace-1', 'tab-1');

    // Then: the failed request does not close, while the released guard allows the retry.
    expect(fixture.confirmCloseTab).toHaveBeenCalledTimes(2);
    expect(fixture.closeWorkspaceTab).toHaveBeenCalledOnce();
  });
});
