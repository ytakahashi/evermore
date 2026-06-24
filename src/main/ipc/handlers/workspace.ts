import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import { createSilentLogger, type Logger } from '../../logging/logger';
import { readWorkspace } from '../../workspace/validate-workspace';
import { WorkspaceStore } from '../../workspace/workspace-store';
import { assertIpcRequestAllowed } from '../authorization';
import {
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PATH_LENGTH,
  readNullableStringField,
  readObject,
  readStringField,
  readStringIdPayload,
} from '../validation';

interface RegisterWorkspaceHandlersOptions {
  logger?: Logger;
  workspaceStore?: WorkspaceStore;
}

interface WorkspaceCreatePayload {
  name: string;
  rootPath: string;
}

function readWorkspaceCreatePayload(payload: unknown): WorkspaceCreatePayload {
  const object = readObject(payload, IPC.WS_CREATE);
  return {
    name: readStringField(object, 'name', IPC.WS_CREATE, { maxLength: MAX_NAME_LENGTH }),
    rootPath: readStringField(object, 'rootPath', IPC.WS_CREATE, {
      allowEmpty: true,
      maxLength: MAX_PATH_LENGTH,
    }),
  };
}

function readActiveWorkspaceIdPayload(payload: unknown): string | null {
  const object = readObject(payload, IPC.WS_SET_ACTIVE_ID);
  return readNullableStringField(object, 'id', IPC.WS_SET_ACTIVE_ID, {
    maxLength: MAX_ID_LENGTH,
  });
}

/**
 * Bridges renderer workspace CRUD requests to the main-process persistence store.
 */
export function registerWorkspaceHandlers(
  options: RegisterWorkspaceHandlersOptions = {},
): () => void {
  const logger = options.logger ?? createSilentLogger();
  const workspaceStore = options.workspaceStore ?? new WorkspaceStore({ logger });

  ipcMain.handle(IPC.WS_LIST, () => ({
    workspaces: workspaceStore.list(),
    activeWorkspaceId: workspaceStore.getActiveWorkspaceId(),
  }));
  ipcMain.handle(IPC.WS_GET, (_event, payload: unknown) =>
    workspaceStore.get(readStringIdPayload(payload, 'id', IPC.WS_GET)),
  );
  ipcMain.handle(IPC.WS_CREATE, (_event, payload: unknown) => {
    const request = readWorkspaceCreatePayload(payload);
    return workspaceStore.create(request.name, request.rootPath);
  });
  ipcMain.handle(IPC.WS_UPDATE, (_event, payload: unknown) => {
    const object = readObject(payload, IPC.WS_UPDATE);
    const workspace = readWorkspace(object['workspace'], IPC.WS_UPDATE);
    assertIpcRequestAllowed(IPC.WS_UPDATE, workspaceStore.get(workspace.id) !== null);
    workspaceStore.update(workspace);
  });
  ipcMain.handle(IPC.WS_DELETE, (_event, payload: unknown) => {
    workspaceStore.delete(readStringIdPayload(payload, 'id', IPC.WS_DELETE));
  });
  ipcMain.handle(IPC.WS_SET_ACTIVE_ID, (_event, payload: unknown) => {
    workspaceStore.setActiveWorkspaceId(readActiveWorkspaceIdPayload(payload));
  });

  return () => {
    ipcMain.removeHandler(IPC.WS_LIST);
    ipcMain.removeHandler(IPC.WS_GET);
    ipcMain.removeHandler(IPC.WS_CREATE);
    ipcMain.removeHandler(IPC.WS_UPDATE);
    ipcMain.removeHandler(IPC.WS_DELETE);
    ipcMain.removeHandler(IPC.WS_SET_ACTIVE_ID);
  };
}
