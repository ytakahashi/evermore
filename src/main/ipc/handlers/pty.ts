import { ipcMain, type BrowserWindow } from 'electron';
import type { PtyCreateRequest } from '../../../shared/api-types';
import { IPC } from '../../../shared/ipc-channels';
import { PtyManager } from '../../pty/pty-manager';
import {
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  MAX_PTY_DIMENSION,
  MAX_PTY_WRITE_LENGTH,
  readObject,
  readOptionalStringField,
  readPositiveIntegerField,
  readStringField,
  readStringIdPayload,
} from '../validation';

interface RegisterPtyHandlersOptions {
  getWindow: () => BrowserWindow | null;
  ptyManager?: PtyManager;
}

interface PtyWritePayload {
  id: string;
  data: string;
}

interface PtyResizePayload {
  id: string;
  cols: number;
  rows: number;
}

function readPtyCreatePayload(payload: unknown): PtyCreateRequest {
  const object = readObject(payload, IPC.PTY_CREATE);
  const cwd = readStringField(object, 'cwd', IPC.PTY_CREATE, {
    allowEmpty: true,
    maxLength: MAX_PATH_LENGTH,
  });
  const paneId = readOptionalStringField(object, 'paneId', IPC.PTY_CREATE, {
    maxLength: MAX_ID_LENGTH,
  });

  return {
    cwd,
    ...(paneId !== undefined ? { paneId } : {}),
  };
}

function readPtyWritePayload(payload: unknown): PtyWritePayload {
  const object = readObject(payload, IPC.PTY_WRITE);
  return {
    id: readStringField(object, 'id', IPC.PTY_WRITE, { maxLength: MAX_ID_LENGTH }),
    data: readStringField(object, 'data', IPC.PTY_WRITE, {
      allowEmpty: true,
      maxLength: MAX_PTY_WRITE_LENGTH,
    }),
  };
}

function readPtyResizePayload(payload: unknown): PtyResizePayload {
  const object = readObject(payload, IPC.PTY_RESIZE);
  return {
    id: readStringField(object, 'id', IPC.PTY_RESIZE, { maxLength: MAX_ID_LENGTH }),
    cols: readPositiveIntegerField(object, 'cols', IPC.PTY_RESIZE, {
      max: MAX_PTY_DIMENSION,
    }),
    rows: readPositiveIntegerField(object, 'rows', IPC.PTY_RESIZE, {
      max: MAX_PTY_DIMENSION,
    }),
  };
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

  ipcMain.handle(IPC.PTY_CREATE, (_event, payload: unknown) =>
    ptyManager.create(readPtyCreatePayload(payload)),
  );
  ipcMain.handle(IPC.PTY_WRITE, (_event, payload: unknown) => {
    const request = readPtyWritePayload(payload);
    ptyManager.write(request.id, request.data);
  });
  ipcMain.handle(IPC.PTY_RESIZE, (_event, payload: unknown) => {
    const request = readPtyResizePayload(payload);
    ptyManager.resize(request.id, request.cols, request.rows);
  });
  ipcMain.handle(IPC.PTY_DISPOSE, (_event, payload: unknown) => {
    ptyManager.dispose(readStringIdPayload(payload, 'id', IPC.PTY_DISPOSE));
  });

  return () => {
    ipcMain.removeHandler(IPC.PTY_CREATE);
    ipcMain.removeHandler(IPC.PTY_WRITE);
    ipcMain.removeHandler(IPC.PTY_RESIZE);
    ipcMain.removeHandler(IPC.PTY_DISPOSE);
    ptyManager.disposeAll();
  };
}
