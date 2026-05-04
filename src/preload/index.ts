import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { Workspace, AppSettings, SSHHost, Tunnel } from '../shared/types';
import type { Api } from '../shared/api-types';

// Each pane subscribes its own callback via onData/onExit. Registering a new ipcRenderer.on()
// per pane would exceed Node's default 10-listener limit with many open panes. A single
// ipcRenderer listener per channel dispatches to a subscriber set instead.
const ptyDataSubscribers = new Set<(id: string, data: string) => void>();
const ptyExitSubscribers = new Set<(id: string, code: number) => void>();

ipcRenderer.on(IPC.PTY_DATA, (_: unknown, payload: { id: string; data: string }) => {
  for (const cb of ptyDataSubscribers) {
    cb(payload.id, payload.data);
  }
});

ipcRenderer.on(IPC.PTY_EXIT, (_: unknown, payload: { id: string; code: number }) => {
  for (const cb of ptyExitSubscribers) {
    cb(payload.id, payload.code);
  }
});

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
      ptyDataSubscribers.add(cb);
      return (): void => {
        ptyDataSubscribers.delete(cb);
      };
    },
    onExit: (cb: (id: string, code: number) => void): (() => void) => {
      ptyExitSubscribers.add(cb);
      return (): void => {
        ptyExitSubscribers.delete(cb);
      };
    },
  },
  workspace: {
    list: (): Promise<{ workspaces: Workspace[]; activeWorkspaceId: string | null }> =>
      ipcRenderer.invoke(IPC.WS_LIST),
    get: (id: string): Promise<Workspace | null> => ipcRenderer.invoke(IPC.WS_GET, { id }),
    create: (name: string, rootPath: string): Promise<Workspace> =>
      ipcRenderer.invoke(IPC.WS_CREATE, { name, rootPath }),
    update: (workspace: Workspace): Promise<void> =>
      ipcRenderer.invoke(IPC.WS_UPDATE, { workspace }),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.WS_DELETE, { id }),
    setActiveWorkspaceId: (id: string | null): Promise<void> =>
      ipcRenderer.invoke(IPC.WS_SET_ACTIVE_ID, { id }),
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
} satisfies Api;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error window.api is declared in index.d.ts (web tsconfig only)
  window.api = api;
}
