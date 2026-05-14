export interface Workspace {
  id: string;
  name: string;
  rootPath: string; // workspace root directory (absolute path)
  tabs: Tab[];
  panes: Pane[];
  activeTabId: string | null;
  createdAt: number; // unix ms
  updatedAt: number;
}

export interface Tab {
  id: string;
  name: string;
  layout: PaneLayout;
  activePaneId: string | null;
}

export type PaneLayout =
  | { type: 'leaf'; paneId: string }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      children: [PaneLayout, PaneLayout];
    };

export interface Pane {
  id: string;
  cwd: string; // absolute path
  ptyId?: string; // runtime only
  initialCommand?: string; // runtime only; sanitizePane drops it from persistence so restored panes do not replay
}

export type PaneActivity = 'idle' | 'running';

export interface PaneRuntimeInfo {
  ptyId: string;
  activity: PaneActivity;
  /** Foreground command line when activity is running. */
  foregroundCommand?: string;
  /** Unix timestamp in milliseconds for the latest observation. */
  observedAt: number;
}

export interface SSHHost {
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  hasForwarding: boolean;
  forwards: ForwardEntry[];
}

export interface Tunnel {
  alias: string;
  forwards: ForwardEntry[];
  status: TunnelStatus;
  pid?: number;
  /** Unix timestamp (ms) when the tunnel reached the 'running' state. */
  startedAt?: number;
  lastError?: string;
  /** Ring buffer of recent log lines, capped at TUNNEL_LOG_BUFFER_SIZE (default 200). */
  recentLogs: string[];
}

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ForwardEntry {
  type: 'local' | 'remote' | 'dynamic';
  bindAddress?: string;
  bindPort: number;
  hostAddress?: string;
  hostPort?: number;
}

export type FontWeight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

/**
 * Application-wide user preferences persisted by the main process.
 *
 * Persisted to `~/.config/evermore/settings.json` so users can hand-edit it.
 * Renderer-only transient UI state (sidebar open/close, sidebar width, fullscreen pane id)
 * lives in `useUiStore` and is intentionally not part of `AppSettings`.
 */
export interface AppSettings {
  terminal: {
    cursorStyle: 'block' | 'bar' | 'underline';
    cursorBlink: boolean;
    macOptionIsMeta: boolean;
    copyOnSelect: boolean;
    fontSize: number;
    fontFamily: string;
    fontWeight: FontWeight;
    fontWeightBold: FontWeight;
  };
  paneInfo: {
    /** ps polling interval in ms; values <= 0 disable polling. */
    pollIntervalMs: number;
  };
  shortcuts: {
    /**
     * Toggles the global hotkey that brings the Evermore window to the front. `null` means the
     * hotkey is disabled. Stored as a parsed Electron Accelerator string.
     */
    activateAppHotkey: string | null;
    /**
     * Action id -> Accelerator. The bindings are persisted only; the runtime that reads them and
     * binds the actual key handlers is not yet implemented, so editing this map currently has no
     * effect on the running app.
     */
    keybindings: Record<string, string>;
  };
  app: {
    quitConfirm: 'always' | 'never' | 'running-only';
  };
}
