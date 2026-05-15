import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';

interface RegisterWindowHandlersOptions {
  getWindow: () => BrowserWindow | null;
}

/**
 * Registers IPC handlers for window-level state and actions.
 */
export function registerWindowHandlers(options: RegisterWindowHandlersOptions): () => void {
  ipcMain.handle(IPC.WINDOW_IS_FULLSCREEN, () => {
    const window = options.getWindow();
    return window ? window.isFullScreen() : false;
  });

  return () => {
    ipcMain.removeHandler(IPC.WINDOW_IS_FULLSCREEN);
  };
}
