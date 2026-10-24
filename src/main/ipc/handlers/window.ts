import {
  ipcMain,
  type BrowserWindow,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron';
import { IPC } from '../../../shared/ipc-channels';

interface RegisterWindowHandlersOptions {
  getWindow: () => BrowserWindow | null;
  showMessageBox: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
  showOpenDialog: (
    window: BrowserWindow,
    options: OpenDialogOptions,
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
}

function parseConfirmClosePayload(
  payload: unknown,
  channel: string,
): { runningProcesses: boolean } {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>)['runningProcesses'] !== 'boolean'
  ) {
    throw new Error(`Invalid IPC payload for ${channel}`);
  }

  return {
    runningProcesses: (payload as Record<string, unknown>)['runningProcesses'] as boolean,
  };
}

// The picker takes no renderer input, so its copy and properties stay fixed in main.
const PICK_DIRECTORY_DIALOG_OPTIONS: OpenDialogOptions = {
  properties: ['openDirectory', 'createDirectory'],
};

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

function createCloseWorkspaceDialogOptions(runningProcesses: boolean): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['Close Workspace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Close Workspace?',
    message: runningProcesses
      ? 'Terminal processes are still running in this workspace.'
      : 'Close this workspace?',
    detail:
      'Closing this workspace will stop all of its terminal sessions. Its layout and working directories will be kept for reopening.',
    noLink: true,
  };
}

/**
 * Registers IPC handlers for window-level state and actions.
 */
export function registerWindowHandlers(options: RegisterWindowHandlersOptions): () => void {
  let closePromptOpen = false;
  let directoryPickerOpen = false;

  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, () => {
    const window = options.getWindow();
    return window ? window.isFullScreen() : false;
  });

  // Both terminal-close operations share one sheet guard for this window.
  const closeConfirmations = [
    [IPC.WINDOW_CONFIRM_CLOSE_TAB, createCloseTabDialogOptions],
    [IPC.WINDOW_CONFIRM_CLOSE_WORKSPACE, createCloseWorkspaceDialogOptions],
  ] as const;
  for (const [channel, createDialogOptions] of closeConfirmations) {
    ipcMain.handle(channel, async (_event, payload: unknown) => {
      const { runningProcesses } = parseConfirmClosePayload(payload, channel);
      const window = options.getWindow();
      if (!window || window.isDestroyed()) {
        return true;
      }
      if (closePromptOpen) {
        return false;
      }

      closePromptOpen = true;
      try {
        const result = await options.showMessageBox(window, createDialogOptions(runningProcesses));
        return result.response === 0;
      } finally {
        closePromptOpen = false;
      }
    });
  }

  ipcMain.handle(IPC.WINDOW_PICK_DIRECTORY, async () => {
    const window = options.getWindow();
    // Unlike tab-close confirmation, there is no safe default selection, so an unavailable window
    // and an overlapping request both resolve as a cancel.
    if (!window || window.isDestroyed() || directoryPickerOpen) {
      return null;
    }

    directoryPickerOpen = true;
    try {
      const result = await options.showOpenDialog(window, PICK_DIRECTORY_DIALOG_OPTIONS);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    } finally {
      directoryPickerOpen = false;
    }
  });

  return () => {
    ipcMain.removeHandler(IPC.WINDOW_IS_FULLSCREEN);
    ipcMain.removeHandler(IPC.WINDOW_CONFIRM_CLOSE_TAB);
    ipcMain.removeHandler(IPC.WINDOW_CONFIRM_CLOSE_WORKSPACE);
    ipcMain.removeHandler(IPC.WINDOW_PICK_DIRECTORY);
  };
}
