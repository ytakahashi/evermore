import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { ipcMainMock, requireHandler, resetIpcMainMock } from './test-utils/ipc-main-mock';
import { registerPaneInfoHandlers } from './pane-info';

interface TestPaneInfoTracker {
  dispose: ReturnType<typeof vi.fn<() => void>>;
  list: ReturnType<typeof vi.fn<() => PaneRuntimeInfo[]>>;
  register: ReturnType<typeof vi.fn<(ptyId: string) => void>>;
  unregister: ReturnType<typeof vi.fn<(ptyId: string) => void>>;
}

function createPaneInfoTracker(info: PaneRuntimeInfo[] = []): TestPaneInfoTracker {
  return {
    dispose: vi.fn(),
    list: vi.fn(() => info),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

describe('registerPaneInfoHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('registers the list handler', () => {
    // Given: an injected pane info tracker.
    const info: PaneRuntimeInfo = {
      ptyId: 'pty-1',
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
    const paneInfoTracker = createPaneInfoTracker([info]);

    // When: pane info handlers are registered and invoked.
    const dispose = registerPaneInfoHandlers({
      getWindow: () => null,
      paneInfoTracker,
    });
    const listed = requireHandler(IPC.PANE_INFO_LIST)({});
    dispose();

    // Then: requests are bridged to the tracker and cleanup removes handlers.
    expect(listed).toEqual([info]);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_LIST);
    expect(paneInfoTracker.dispose).toHaveBeenCalledOnce();
  });
});
