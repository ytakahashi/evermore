import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { PaneInfoTracker } from '../../pane-info/pane-info-tracker';

type PaneInfoRuntimeTracker = Pick<
  PaneInfoTracker,
  'dispose' | 'list' | 'notifyCommand' | 'register' | 'unregister'
>;

interface RegisterPaneInfoHandlersOptions {
  getWindow: () => BrowserWindow | null;
  paneInfoTracker?: PaneInfoRuntimeTracker;
}

function isWindowAvailable(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed();
}

/**
 * Bridges renderer pane-info requests to the main-process runtime tracker.
 */
export function registerPaneInfoHandlers(options: RegisterPaneInfoHandlersOptions): () => void {
  const paneInfoTracker =
    options.paneInfoTracker ??
    new PaneInfoTracker({
      callbacks: {
        onChanged: ({ info }) => {
          const window = options.getWindow();
          if (isWindowAvailable(window)) {
            window.webContents.send(IPC.PANE_INFO_CHANGED, info);
          }
        },
      },
    });

  ipcMain.handle(IPC.PANE_INFO_LIST, (): PaneRuntimeInfo[] => paneInfoTracker.list());
  ipcMain.handle(
    IPC.PANE_INFO_NOTIFY_COMMAND,
    (_event, payload: { ptyId: string; command: string }) => {
      paneInfoTracker.notifyCommand(payload.ptyId, payload.command);
    },
  );

  return () => {
    ipcMain.removeHandler(IPC.PANE_INFO_LIST);
    ipcMain.removeHandler(IPC.PANE_INFO_NOTIFY_COMMAND);
    paneInfoTracker.dispose();
  };
}
