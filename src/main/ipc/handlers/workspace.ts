import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { Workspace } from '../../../shared/types';
import { WorkspaceStore } from '../../workspace/workspace-store';

interface RegisterWorkspaceHandlersOptions {
  workspaceStore?: WorkspaceStore;
}

/**
 * Bridges renderer workspace CRUD requests to the main-process persistence store.
 */
export function registerWorkspaceHandlers(
  options: RegisterWorkspaceHandlersOptions = {},
): () => void {
  const workspaceStore = options.workspaceStore ?? new WorkspaceStore();

  ipcMain.handle(IPC.WS_LIST, () => ({
    workspaces: workspaceStore.list(),
    activeWorkspaceId: workspaceStore.getActiveWorkspaceId(),
  }));
  ipcMain.handle(IPC.WS_GET, (_event, payload: { id: string }) => workspaceStore.get(payload.id));
  ipcMain.handle(IPC.WS_CREATE, (_event, payload: { name: string; rootPath: string }) =>
    workspaceStore.create(payload.name, payload.rootPath),
  );
  ipcMain.handle(IPC.WS_UPDATE, (_event, payload: { workspace: Workspace }) => {
    workspaceStore.update(payload.workspace);
  });
  ipcMain.handle(IPC.WS_DELETE, (_event, payload: { id: string }) => {
    workspaceStore.delete(payload.id);
  });
  ipcMain.handle(IPC.WS_SET_ACTIVE_ID, (_event, payload: { id: string | null }) => {
    workspaceStore.setActiveWorkspaceId(payload.id);
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
