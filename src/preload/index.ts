import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { Workspace, AppSettings, SSHHost, Tunnel } from '../shared/types';

// Define the API exposed to the renderer
const api = {
  pty: {
    create: (opts: { cwd: string; shell?: string }): Promise<string> =>
      ipcRenderer.invoke(IPC.PTY_CREATE, opts),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PTY_RESIZE, { id, cols, rows }),
    dispose: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PTY_DISPOSE, { id }),
    onData: (cb: (id: string, data: string) => void): (() => void) => {
      const handler = (_: unknown, payload: { id: string; data: string }): void =>
        cb(payload.id, payload.data);
      ipcRenderer.on(IPC.PTY_DATA, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.PTY_DATA, handler);
      };
    },
    onExit: (cb: (id: string, code: number) => void): (() => void) => {
      const handler = (_: unknown, payload: { id: string; code: number }): void =>
        cb(payload.id, payload.code);
      ipcRenderer.on(IPC.PTY_EXIT, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
      };
    },
  },
  workspace: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke(IPC.WS_LIST),
    get: (id: string): Promise<Workspace | null> => ipcRenderer.invoke(IPC.WS_GET, { id }),
    create: (name: string, rootPath: string): Promise<Workspace> =>
      ipcRenderer.invoke(IPC.WS_CREATE, { name, rootPath }),
    update: (workspace: Workspace): Promise<void> =>
      ipcRenderer.invoke(IPC.WS_UPDATE, { workspace }),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.WS_DELETE, { id }),
  },
  ssh: {
    listHosts: (): Promise<SSHHost[]> => ipcRenderer.invoke(IPC.SSH_LIST_HOSTS),
    resolve: (alias: string): Promise<Record<string, string[]>> =>
      ipcRenderer.invoke(IPC.SSH_RESOLVE, { alias }),
    onConfigChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb();
      ipcRenderer.on(IPC.SSH_CONFIG_CHANGED, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.SSH_CONFIG_CHANGED, handler);
      };
    },
  },
  tunnel: {
    list: (): Promise<Tunnel[]> => ipcRenderer.invoke(IPC.TUNNEL_LIST),
    start: (alias: string): Promise<void> => ipcRenderer.invoke(IPC.TUNNEL_START, { alias }),
    stop: (alias: string): Promise<void> => ipcRenderer.invoke(IPC.TUNNEL_STOP, { alias }),
    logs: (alias: string): Promise<string[]> => ipcRenderer.invoke(IPC.TUNNEL_LOGS, { alias }),
    onStatusChanged: (
      cb: (alias: string, status: string, error?: string) => void,
    ): (() => void) => {
      const handler = (
        _: unknown,
        payload: { alias: string; status: string; error?: string },
      ): void => cb(payload.alias, payload.status, payload.error);
      ipcRenderer.on(IPC.TUNNEL_STATUS_CHANGED, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.TUNNEL_STATUS_CHANGED, handler);
      };
    },
    onLog: (cb: (alias: string, data: string) => void): (() => void) => {
      const handler = (_: unknown, payload: { alias: string; data: string }): void =>
        cb(payload.alias, payload.data);
      ipcRenderer.on(IPC.TUNNEL_LOG, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.TUNNEL_LOG, handler);
      };
    },
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    update: (settings: Partial<AppSettings>): Promise<void> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, { settings }),
  },
};

// Expose the API to the renderer process
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (defined in dts)
  window.api = api;
}

export type Api = typeof api;
