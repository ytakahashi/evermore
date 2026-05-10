import type {
  Workspace,
  AppSettings,
  PaneRuntimeInfo,
  SSHHost,
  Tunnel,
  TunnelStatus,
} from './types';

export interface Api {
  pty: {
    create: (opts: { cwd: string; shell?: string }) => Promise<string>;
    write: (id: string, data: string) => Promise<void>;
    resize: (id: string, cols: number, rows: number) => Promise<void>;
    dispose: (id: string) => Promise<void>;
    onData: (cb: (id: string, data: string) => void) => () => void;
    onExit: (cb: (id: string, code: number) => void) => () => void;
  };
  paneInfo: {
    list: () => Promise<PaneRuntimeInfo[]>;
    notifyCwd: (ptyId: string, cwd: string) => Promise<void>;
    /**
     * Reports the command text submitted in the terminal UI for display purposes.
     *
     * This is intentionally separate from foreground process inspection: `ps` may see resolved
     * runtime executables such as `node .../pnpm.cjs`, while the sidebar should show the command
     * the user actually ran, such as `pnpm run dev`.
     */
    notifyCommand: (ptyId: string, command: string) => Promise<void>;
    onChanged: (cb: (info: PaneRuntimeInfo) => void) => () => void;
  };
  workspace: {
    list: () => Promise<{ workspaces: Workspace[]; activeWorkspaceId: string | null }>;
    get: (id: string) => Promise<Workspace | null>;
    create: (name: string, rootPath: string) => Promise<Workspace>;
    update: (workspace: Workspace) => Promise<void>;
    delete: (id: string) => Promise<void>;
    setActiveWorkspaceId: (id: string | null) => Promise<void>;
  };
  ssh: {
    listHosts: () => Promise<SSHHost[]>;
    reloadHosts: () => Promise<SSHHost[]>;
    resolve: (alias: string) => Promise<Record<string, string[]>>;
  };
  tunnel: {
    list: () => Promise<Tunnel[]>;
    start: (alias: string) => Promise<void>;
    stop: (alias: string) => Promise<void>;
    logs: (alias: string) => Promise<string[]>;
    onStatusChanged: (
      cb: (alias: string, status: TunnelStatus, error?: string) => void,
    ) => () => void;
    onLog: (cb: (alias: string, data: string) => void) => () => void;
  };
  settings: {
    get: () => Promise<AppSettings>;
    /**
     * Persists a partial settings update and returns the resulting full settings object.
     *
     * Returning the post-write state lets the main process clamp / fall back values it could not
     * accept (for example, hotkey accelerators that fail to register globally), and lets the
     * renderer detect those differences without a separate round-trip.
     */
    update: (settings: SettingsUpdate) => Promise<AppSettings>;
    reset: () => Promise<AppSettings>;
    /** Re-reads the settings file from disk and returns the normalized settings object. */
    reload: () => Promise<AppSettings>;
    /** Opens the settings file in the OS default file manager (Finder on macOS). */
    openFile: () => Promise<void>;
    /** Returns the absolute path to the persisted settings file. */
    getFilePath: () => Promise<string>;
  };
}

/**
 * Partial settings patch accepted by `Api.settings.update`. Each section is independently
 * optional, but a section, when present, must supply the partial subset of its fields.
 */
export type SettingsUpdate = {
  [Section in keyof AppSettings]?: Partial<AppSettings[Section]>;
};
