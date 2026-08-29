import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import { ipcMainMock, requireHandler, resetIpcMainMock } from './test-utils/ipc-main-mock';
import { registerWindowHandlers } from './window';

function createWindow(isDestroyed = false): {
  isDestroyed: ReturnType<typeof vi.fn<() => boolean>>;
  isFullScreen: ReturnType<typeof vi.fn<() => boolean>>;
} {
  return {
    isDestroyed: vi.fn(() => isDestroyed),
    isFullScreen: vi.fn(() => false),
  };
}

describe('registerWindowHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('returns the current fullscreen state', () => {
    // Given: a live window currently in fullscreen mode.
    const window = createWindow();
    window.isFullScreen.mockReturnValue(true);
    registerWindowHandlers({ getWindow: () => window as never, showMessageBox: vi.fn() });

    // When: the renderer asks for window state.
    const isFullScreen = requireHandler(IPC.WINDOW_IS_FULLSCREEN)({});

    // Then: the BrowserWindow state is returned unchanged.
    expect(isFullScreen).toBe(true);
  });

  it.each([
    ['running-process copy', true, 'A terminal process is still running in this tab.'],
    ['generic copy', false, 'Close this tab?'],
  ])('returns the selected action with %s', async (_label, runningProcesses, message) => {
    // Given: an available window and a dialog that selects Close Tab.
    const window = createWindow();
    const showMessageBox = vi.fn(() => Promise.resolve({ response: 0 }));
    registerWindowHandlers({ getWindow: () => window as never, showMessageBox });

    // When: the renderer requests tab-close confirmation.
    const confirmed = await requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB)({}, { runningProcesses });

    // Then: the native copy reflects the request and the Close Tab response is accepted.
    expect(confirmed).toBe(true);
    expect(showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        buttons: ['Close Tab', 'Cancel'],
        cancelId: 1,
        defaultId: 1,
        message,
      }),
    );
  });

  it('returns false when the user cancels', async () => {
    // Given: a dialog that selects Cancel.
    const window = createWindow();
    const showMessageBox = vi.fn(() => Promise.resolve({ response: 1 }));
    registerWindowHandlers({ getWindow: () => window as never, showMessageBox });

    // When: confirmation is requested.
    const confirmed = await requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB)(
      {},
      { runningProcesses: true },
    );

    // Then: the close is rejected.
    expect(confirmed).toBe(false);
  });

  it('allows the close without showing a dialog when the window is unavailable', async () => {
    // Given: there is no live window that can own a native sheet.
    const showMessageBox = vi.fn();
    registerWindowHandlers({ getWindow: () => null, showMessageBox });

    // When: confirmation is requested with a valid payload.
    const confirmed = await requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB)(
      {},
      { runningProcesses: true },
    );

    // Then: the operation is not blocked on an impossible dialog.
    expect(confirmed).toBe(true);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('allows the close without showing a dialog when the window is destroyed', async () => {
    // Given: the renderer request races with destruction of its native window.
    const window = createWindow(true);
    const showMessageBox = vi.fn();
    registerWindowHandlers({ getWindow: () => window as never, showMessageBox });

    // When: confirmation is requested with a valid payload.
    const confirmed = await requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB)(
      {},
      { runningProcesses: true },
    );

    // Then: an impossible sheet does not block the close or call Electron's dialog API.
    expect(confirmed).toBe(true);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it.each([null, {}, { runningProcesses: 'yes' }, []])(
    'rejects malformed confirmation payloads before resolving the window',
    async (payload) => {
      // Given: a window resolver whose use is observable.
      const getWindow = vi.fn(() => null);
      registerWindowHandlers({ getWindow, showMessageBox: vi.fn() });

      // When / Then: invalid renderer input is rejected without consulting native state.
      await expect(requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB)({}, payload)).rejects.toThrow(
        `Invalid IPC payload for ${IPC.WINDOW_CONFIRM_CLOSE_TAB}`,
      );
      expect(getWindow).not.toHaveBeenCalled();
    },
  );

  it('suppresses a second prompt while the first is open and recovers after rejection', async () => {
    // Given: a first dialog request that remains pending.
    const window = createWindow();
    let rejectFirst: ((reason: Error) => void) | undefined;
    const showMessageBox = vi
      .fn<() => Promise<{ response: number }>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue({ response: 0 });
    registerWindowHandlers({ getWindow: () => window as never, showMessageBox });
    const handler = requireHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB);

    // When: another request arrives before the first sheet settles.
    const first = handler({}, { runningProcesses: true }) as Promise<boolean>;
    const overlapping = await handler({}, { runningProcesses: true });

    // Then: the overlapping request is cancelled, and a failed first prompt releases the guard.
    expect(overlapping).toBe(false);
    rejectFirst?.(new Error('dialog unavailable'));
    await expect(first).rejects.toThrow('dialog unavailable');
    await expect(handler({}, { runningProcesses: false })).resolves.toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('removes both window handlers during teardown', () => {
    // Given: registered window handlers.
    const dispose = registerWindowHandlers({ getWindow: () => null, showMessageBox: vi.fn() });

    // When: registration is disposed.
    dispose();

    // Then: no stale invoke handler remains.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WINDOW_IS_FULLSCREEN);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WINDOW_CONFIRM_CLOSE_TAB);
  });
});
