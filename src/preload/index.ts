import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { KeyboardShortcutActionId } from '../shared/keyboard-shortcuts';
import type {
  Workspace,
  AppSettings,
  PaneRuntimeInfo,
  SSHHost,
  Tunnel,
  TunnelStatus,
} from '../shared/types';
import type { Api, PtyCreateRequest, SettingsUpdate } from '../shared/api-types';

// Each pane subscribes its own callback via onData/onExit. Registering a new ipcRenderer.on()
// per pane would exceed Node's default 10-listener limit with many open panes. A single
// ipcRenderer listener per channel dispatches to a subscriber map instead.
//
// Keyed by a per-subscribe() symbol rather than the callback itself: two subscriptions that
// happen to pass a referentially identical function (e.g. a memoized callback reused across
// hook instances) must stay independent, so unsubscribing one must never remove the other.
//
// Each dispatch loop below iterates `Map.values()` directly rather than a snapshot taken before
// the loop starts. This is a deliberate choice: `Map.values()` is a live iterator, so an
// unsubscribe triggered by an earlier callback in the same dispatch takes effect immediately and
// the removed callback is skipped, while a subscribe triggered mid-dispatch may still receive the
// event currently being fanned out. No current subscriber mutates subscriptions from inside its
// own callback, so this asymmetry is not observed in practice; it is noted here so a future
// subscriber that does mutate during dispatch does not treat the ordering as accidental.
const ptyDataSubscribers = new Map<symbol, (id: string, data: string) => void>();
const ptyExitSubscribers = new Map<symbol, (id: string, code: number) => void>();
const paneInfoChangedSubscribers = new Map<symbol, (info: PaneRuntimeInfo) => void>();
const shortcutInvokeSubscribers = new Map<symbol, (actionId: KeyboardShortcutActionId) => void>();
const tunnelStatusChangedSubscribers = new Map<
  symbol,
  (alias: string, status: TunnelStatus, error?: string) => void
>();
const tunnelLogSubscribers = new Map<symbol, (alias: string, data: string) => void>();
const windowFullScreenChangedSubscribers = new Map<symbol, (isFullScreen: boolean) => void>();

ipcRenderer.on(IPC.PTY_DATA, (_: unknown, payload: { id: string; data: string }) => {
  for (const cb of ptyDataSubscribers.values()) {
    cb(payload.id, payload.data);
  }
});

ipcRenderer.on(IPC.PTY_EXIT, (_: unknown, payload: { id: string; code: number }) => {
  for (const cb of ptyExitSubscribers.values()) {
    cb(payload.id, payload.code);
  }
});

ipcRenderer.on(IPC.PANE_INFO_CHANGED, (_: unknown, payload: PaneRuntimeInfo) => {
  for (const cb of paneInfoChangedSubscribers.values()) {
    cb(payload);
  }
});

ipcRenderer.on(
  IPC.SHORTCUT_INVOKE,
  (_: unknown, payload: { actionId: KeyboardShortcutActionId }) => {
    for (const cb of shortcutInvokeSubscribers.values()) {
      cb(payload.actionId);
    }
  },
);

ipcRenderer.on(
  IPC.TUNNEL_STATUS_CHANGED,
  (_: unknown, payload: { alias: string; status: TunnelStatus; error?: string }) => {
    for (const cb of tunnelStatusChangedSubscribers.values()) {
      cb(payload.alias, payload.status, payload.error);
    }
  },
);

ipcRenderer.on(IPC.TUNNEL_LOG, (_: unknown, payload: { alias: string; data: string }) => {
  for (const cb of tunnelLogSubscribers.values()) {
    cb(payload.alias, payload.data);
  }
});

ipcRenderer.on(IPC.WINDOW_FULLSCREEN_CHANGED, (_: unknown, isFullScreen: boolean) => {
  for (const cb of windowFullScreenChangedSubscribers.values()) {
    cb(isFullScreen);
  }
});

const api = {
  pty: {
    create: (opts: PtyCreateRequest): Promise<string> => ipcRenderer.invoke(IPC.PTY_CREATE, opts),
    write: (id: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PTY_RESIZE, { id, cols, rows }),
    dispose: (id: string): Promise<void> => ipcRenderer.invoke(IPC.PTY_DISPOSE, { id }),
    onData: (cb: (id: string, data: string) => void): (() => void) => {
      const token = Symbol();
      ptyDataSubscribers.set(token, cb);
      return (): void => {
        ptyDataSubscribers.delete(token);
      };
    },
    onExit: (cb: (id: string, code: number) => void): (() => void) => {
      const token = Symbol();
      ptyExitSubscribers.set(token, cb);
      return (): void => {
        ptyExitSubscribers.delete(token);
      };
    },
  },
  paneInfo: {
    list: (): Promise<PaneRuntimeInfo[]> => ipcRenderer.invoke(IPC.PANE_INFO_LIST),
    notifyCommand: (ptyId: string, command: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PANE_INFO_NOTIFY_COMMAND, { ptyId, command }),
    onChanged: (cb: (info: PaneRuntimeInfo) => void): (() => void) => {
      const token = Symbol();
      paneInfoChangedSubscribers.set(token, cb);
      return (): void => {
        paneInfoChangedSubscribers.delete(token);
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
    clearDiagnostics: (alias: string): Promise<void> =>
      ipcRenderer.invoke(IPC.TUNNEL_CLEAR_DIAGNOSTICS, { alias }),
    onStatusChanged: (
      cb: (alias: string, status: TunnelStatus, error?: string) => void,
    ): (() => void) => {
      const token = Symbol();
      tunnelStatusChangedSubscribers.set(token, cb);
      return (): void => {
        tunnelStatusChangedSubscribers.delete(token);
      };
    },
    onLog: (cb: (alias: string, data: string) => void): (() => void) => {
      const token = Symbol();
      tunnelLogSubscribers.set(token, cb);
      return (): void => {
        tunnelLogSubscribers.delete(token);
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
      const token = Symbol();
      windowFullScreenChangedSubscribers.set(token, cb);
      return (): void => {
        windowFullScreenChangedSubscribers.delete(token);
      };
    },
  },
  shortcuts: {
    onInvoke: (cb: (actionId: KeyboardShortcutActionId) => void): (() => void) => {
      const token = Symbol();
      shortcutInvokeSubscribers.set(token, cb);
      return (): void => {
        shortcutInvokeSubscribers.delete(token);
      };
    },
  },
} satisfies Api;

contextBridge.exposeInMainWorld('api', api);
