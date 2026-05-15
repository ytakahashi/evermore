import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type {
  Workspace,
  AppSettings,
  PaneRuntimeInfo,
  SSHHost,
  Tunnel,
  TunnelStatus,
} from '../shared/types';
import type { Api, SettingsUpdate } from '../shared/api-types';

// Each pane subscribes its own callback via onData/onExit. Registering a new ipcRenderer.on()
// per pane would exceed Node's default 10-listener limit with many open panes. A single
// ipcRenderer listener per channel dispatches to a subscriber set instead.
const ptyDataSubscribers = new Set<(id: string, data: string) => void>();
const ptyExitSubscribers = new Set<(id: string, code: number) => void>();
const paneInfoChangedSubscribers = new Set<(info: PaneRuntimeInfo) => void>();

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

ipcRenderer.on(IPC.PANE_INFO_CHANGED, (_: unknown, payload: PaneRuntimeInfo) => {
  for (const cb of paneInfoChangedSubscribers) {
    cb(payload);
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
  paneInfo: {
    list: (): Promise<PaneRuntimeInfo[]> => ipcRenderer.invoke(IPC.PANE_INFO_LIST),
    notifyCwd: (ptyId: string, cwd: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PANE_INFO_NOTIFY_CWD, { ptyId, cwd }),
    notifyCommand: (ptyId: string, command: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PANE_INFO_NOTIFY_COMMAND, { ptyId, command }),
    onChanged: (cb: (info: PaneRuntimeInfo) => void): (() => void) => {
      paneInfoChangedSubscribers.add(cb);
      return (): void => {
        paneInfoChangedSubscribers.delete(cb);
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
    reloadHosts: (): Promise<SSHHost[]> => ipcRenderer.invoke(IPC.SSH_RELOAD_HOSTS),
    resolve: (alias: string): Promise<Record<string, string[]>> =>
      ipcRenderer.invoke(IPC.SSH_RESOLVE, { alias }),
  },
  tunnel: {
    list: (): Promise<Tunnel[]> => ipcRenderer.invoke(IPC.TUNNEL_LIST),
    start: (alias: string): Promise<void> => ipcRenderer.invoke(IPC.TUNNEL_START, { alias }),
    stop: (alias: string): Promise<void> => ipcRenderer.invoke(IPC.TUNNEL_STOP, { alias }),
    logs: (alias: string): Promise<string[]> => ipcRenderer.invoke(IPC.TUNNEL_LOGS, { alias }),
    onStatusChanged: (
      cb: (alias: string, status: TunnelStatus, error?: string) => void,
    ): (() => void) => {
      const handler = (
        _: unknown,
        payload: { alias: string; status: TunnelStatus; error?: string },
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
    update: (settings: SettingsUpdate): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, { settings }),
    reset: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_RESET),
    reload: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_RELOAD),
    openFile: (): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_FILE),
    getFilePath: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_GET_FILE_PATH),
  },
  window: {
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOW_IS_FULLSCREEN),
    onFullScreenChanged: (cb: (isFullScreen: boolean) => void): (() => void) => {
      const handler = (_: unknown, isFullScreen: boolean): void => cb(isFullScreen);
      ipcRenderer.on(IPC.WINDOW_FULLSCREEN_CHANGED, handler);
      return (): void => {
        ipcRenderer.removeListener(IPC.WINDOW_FULLSCREEN_CHANGED, handler);
      };
    },
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
