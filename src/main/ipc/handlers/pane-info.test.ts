import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { registerPaneInfoHandlers } from './pane-info';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

function getHandler(channel: string): ((event: unknown, payload?: unknown) => unknown) | undefined {
  return ipcMainMock.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1];
}

describe('registerPaneInfoHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers list and cwd notification handlers', () => {
    // Given: an injected pane info tracker.
    const info: PaneRuntimeInfo = {
      ptyId: 'pty-1',
      activity: 'running',
      processActivity: 'running',
      foregroundCommand: 'pnpm test',
      foregroundSession: { kind: 'other' },
      integration: {
        shell: false,
        protocols: [],
        lastSequenceAt: 0,
        stale: false,
      },
      observedAt: 1000,
    };
    const paneInfoTracker = {
      dispose: vi.fn(),
      list: vi.fn(() => [info]),
      notifyCommand: vi.fn(),
      notifyCwd: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
    };

    // When: pane info handlers are registered and invoked.
    const dispose = registerPaneInfoHandlers({
      getWindow: () => null,
      paneInfoTracker,
    });
    const listed = getHandler(IPC.PANE_INFO_LIST)?.({});
    getHandler(IPC.PANE_INFO_NOTIFY_CWD)?.({}, { ptyId: 'pty-1', cwd: '/Users/tester/project' });
    getHandler(IPC.PANE_INFO_NOTIFY_COMMAND)?.({}, { ptyId: 'pty-1', command: 'pnpm run dev' });
    dispose();

    // Then: requests are bridged to the tracker and cleanup removes handlers.
    expect(listed).toEqual([info]);
    expect(paneInfoTracker.notifyCwd).toHaveBeenCalledWith('pty-1', '/Users/tester/project');
    expect(paneInfoTracker.notifyCommand).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_LIST);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_NOTIFY_CWD);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_NOTIFY_COMMAND);
    expect(paneInfoTracker.dispose).toHaveBeenCalledOnce();
  });
});
