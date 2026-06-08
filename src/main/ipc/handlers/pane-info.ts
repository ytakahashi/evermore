import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { PaneInfoTracker } from '../../pane-info/pane-info-tracker';
import { MAX_COMMAND_LENGTH, MAX_ID_LENGTH, readObject, readStringField } from '../validation';

type PaneInfoRuntimeTracker = Pick<
  PaneInfoTracker,
  'dispose' | 'list' | 'notifyCommand' | 'register' | 'unregister'
>;

interface RegisterPaneInfoHandlersOptions {
  getWindow: () => BrowserWindow | null;
  paneInfoTracker?: PaneInfoRuntimeTracker;
}

interface PaneInfoNotifyCommandPayload {
  ptyId: string;
  command: string;
}

function isWindowAvailable(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed();
}

function readPaneInfoNotifyCommandPayload(payload: unknown): PaneInfoNotifyCommandPayload {
  const object = readObject(payload, IPC.PANE_INFO_NOTIFY_COMMAND);
  return {
    ptyId: readStringField(object, 'ptyId', IPC.PANE_INFO_NOTIFY_COMMAND, {
      maxLength: MAX_ID_LENGTH,
    }),
    command: readStringField(object, 'command', IPC.PANE_INFO_NOTIFY_COMMAND, {
      maxLength: MAX_COMMAND_LENGTH,
    }),
  };
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
  ipcMain.handle(IPC.PANE_INFO_NOTIFY_COMMAND, (_event, payload: unknown) => {
    const request = readPaneInfoNotifyCommandPayload(payload);
    paneInfoTracker.notifyCommand(request.ptyId, request.command);
  });

  return () => {
    ipcMain.removeHandler(IPC.PANE_INFO_LIST);
    ipcMain.removeHandler(IPC.PANE_INFO_NOTIFY_COMMAND);
    paneInfoTracker.dispose();
  };
}
