import { ipcMain, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { IPC } from '../../../shared/ipc-channels';

interface RegisterWindowHandlersOptions {
  getWindow: () => BrowserWindow | null;
  showMessageBox: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
}

function parseConfirmCloseTabPayload(payload: unknown): { runningProcesses: boolean } {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>)['runningProcesses'] !== 'boolean'
  ) {
    throw new Error(`Invalid IPC payload for ${IPC.WINDOW_CONFIRM_CLOSE_TAB}`);
  }

  return {
    runningProcesses: (payload as Record<string, unknown>)['runningProcesses'] as boolean,
  };
}

function createCloseTabDialogOptions(runningProcesses: boolean): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['Close Tab', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Close Tab?',
    message: runningProcesses
      ? 'A terminal process is still running in this tab.'
      : 'Close this tab?',
    detail: 'Closing this tab will stop the terminal sessions it contains.',
    noLink: true,
  };
}

/**
 * Registers IPC handlers for window-level state and actions.
 */
export function registerWindowHandlers(options: RegisterWindowHandlersOptions): () => void {
  let closeTabPromptOpen = false;

  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, () => {
    const window = options.getWindow();
    return window ? window.isFullScreen() : false;
  });

  ipcMain.handle(IPC.WINDOW_CONFIRM_CLOSE_TAB, async (_event, payload: unknown) => {
    const { runningProcesses } = parseConfirmCloseTabPayload(payload);
    const window = options.getWindow();
    if (!window || window.isDestroyed()) {
      return true;
    }
    if (closeTabPromptOpen) {
      return false;
    }

    closeTabPromptOpen = true;
    try {
      const result = await options.showMessageBox(
        window,
        createCloseTabDialogOptions(runningProcesses),
      );
      return result.response === 0;
    } finally {
      closeTabPromptOpen = false;
    }
  });

  return () => {
    ipcMain.removeHandler(IPC.WINDOW_IS_FULLSCREEN);
    ipcMain.removeHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB);
  };
}
