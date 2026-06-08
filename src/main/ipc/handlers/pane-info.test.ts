import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { MAX_COMMAND_LENGTH, MAX_ID_LENGTH } from '../validation';
import {
  expectInvalidPayload,
  ipcMainMock,
  requireHandler,
  resetIpcMainMock,
} from './test-utils/ipc-main-mock';
import { registerPaneInfoHandlers } from './pane-info';

interface TestPaneInfoTracker {
  dispose: ReturnType<typeof vi.fn<() => void>>;
  list: ReturnType<typeof vi.fn<() => PaneRuntimeInfo[]>>;
  notifyCommand: ReturnType<typeof vi.fn<(ptyId: string, command: string) => void>>;
  register: ReturnType<typeof vi.fn<(ptyId: string) => void>>;
  unregister: ReturnType<typeof vi.fn<(ptyId: string) => void>>;
}

function createPaneInfoTracker(info: PaneRuntimeInfo[] = []): TestPaneInfoTracker {
  return {
    dispose: vi.fn(),
    list: vi.fn(() => info),
    notifyCommand: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

describe('registerPaneInfoHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('registers list and command notification handlers', () => {
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
    requireHandler(IPC.PANE_INFO_NOTIFY_COMMAND)({}, { ptyId: 'pty-1', command: 'pnpm run dev' });
    dispose();

    // Then: requests are bridged to the tracker and cleanup removes handlers.
    expect(listed).toEqual([info]);
    expect(paneInfoTracker.notifyCommand).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_LIST);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PANE_INFO_NOTIFY_COMMAND);
    expect(paneInfoTracker.dispose).toHaveBeenCalledOnce();
  });

  it('ignores extra command notification payload keys', () => {
    // Given: an injected pane info tracker.
    const paneInfoTracker = createPaneInfoTracker();
    registerPaneInfoHandlers({
      getWindow: () => null,
      paneInfoTracker,
    });

    // When: a renderer reports a command with unrelated extra keys.
    requireHandler(IPC.PANE_INFO_NOTIFY_COMMAND)(
      {},
      { ptyId: 'pty-1', command: 'pnpm run dev', shell: '/bin/bash' },
    );

    // Then: only the validated command notification fields reach the tracker.
    expect(paneInfoTracker.notifyCommand).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
  });

  it.each([
    ['non-object', null],
    ['missing ptyId', { command: 'pnpm run dev' }],
    ['empty ptyId', { ptyId: '', command: 'pnpm run dev' }],
    ['wrong-type ptyId', { ptyId: 1, command: 'pnpm run dev' }],
    ['over-limit ptyId', { ptyId: 'x'.repeat(MAX_ID_LENGTH + 1), command: 'pnpm run dev' }],
    ['missing command', { ptyId: 'pty-1' }],
    ['empty command', { ptyId: 'pty-1', command: '' }],
    ['wrong-type command', { ptyId: 'pty-1', command: 1 }],
    ['over-limit command', { ptyId: 'pty-1', command: 'x'.repeat(MAX_COMMAND_LENGTH + 1) }],
  ])('rejects invalid command notification payloads: %s', (_label: string, payload: unknown) => {
    // Given: an injected pane info tracker.
    const paneInfoTracker = createPaneInfoTracker();
    registerPaneInfoHandlers({
      getWindow: () => null,
      paneInfoTracker,
    });

    // When / Then: the malformed payload is rejected before notifying the tracker.
    expectInvalidPayload(IPC.PANE_INFO_NOTIFY_COMMAND, () =>
      requireHandler(IPC.PANE_INFO_NOTIFY_COMMAND)({}, payload),
    );
    expect(paneInfoTracker.notifyCommand).not.toHaveBeenCalled();
  });
});
