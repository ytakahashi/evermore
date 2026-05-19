import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import { PtyManager } from '../../pty/pty-manager';
import type { PtyCreateOptions } from '../../pty/types';

interface RegisterPtyHandlersOptions {
  getWindow: () => BrowserWindow | null;
  ptyManager?: PtyManager;
}

/**
 * Bridges PTY lifecycle commands from the renderer to the main-process `PtyManager`.
 *
 * Tests can inject a manager, while production creates the real one here so PTY events are routed
 * back to whichever BrowserWindow is currently active.
 */
export function registerPtyHandlers(options: RegisterPtyHandlersOptions): () => void {
  const ptyManager =
    options.ptyManager ??
    new PtyManager({
      callbacks: {
        onData: (event) => {
          const window = options.getWindow();
          // PTY processes are owned by main, so their callbacks can outlive a BrowserWindow. Drop
          // late events instead of letting a closed window turn process output into an app error.
          if (!window?.isDestroyed()) {
            window?.webContents.send(IPC.PTY_DATA, event);
          }
        },
        onExit: (event) => {
          const window = options.getWindow();
          // Exit notifications are best-effort UI updates; the manager has already cleaned up the
          // process record, so there is nothing to recover if no renderer is present.
          if (!window?.isDestroyed()) {
            window?.webContents.send(IPC.PTY_EXIT, event);
          }
        },
      },
    });

  ipcMain.handle(IPC.PTY_CREATE, (_event, createOptions: PtyCreateOptions) =>
    ptyManager.create(createOptions),
  );
  ipcMain.handle(IPC.PTY_WRITE, (_event, payload: { id: string; data: string }) => {
    ptyManager.write(payload.id, payload.data);
  });
  ipcMain.handle(IPC.PTY_RESIZE, (_event, payload: { id: string; cols: number; rows: number }) => {
    ptyManager.resize(payload.id, payload.cols, payload.rows);
  });
  ipcMain.handle(IPC.PTY_DISPOSE, (_event, payload: { id: string }) => {
    ptyManager.dispose(payload.id);
  });

  return () => {
    ipcMain.removeHandler(IPC.PTY_CREATE);
    ipcMain.removeHandler(IPC.PTY_WRITE);
    ipcMain.removeHandler(IPC.PTY_RESIZE);
    ipcMain.removeHandler(IPC.PTY_DISPOSE);
    ptyManager.disposeAll();
  };
}
