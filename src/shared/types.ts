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

export type PaneProcessActivity = 'idle' | 'running';

export type PaneSessionKind = 'none' | 'ssh' | 'other';

export interface PaneForegroundSession {
  kind: PaneSessionKind;
  /** Reserved for future session-specific display metadata. */
  details?: string;
}

export type PaneCommandSource = 'shell-integration' | 'input-heuristic' | 'process-table';

export interface PaneCommandInfo {
  line: string;
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  source: PaneCommandSource;
}

export type PaneIntegrationProtocol = 'osc7' | 'osc133' | 'osc633' | 'osc9' | 'osc777' | 'evermore';

export interface PaneIntegrationInfo {
  /** Sticky indicator that this PTY has emitted shell lifecycle or command-line OSC signals. */
  shell: boolean;
  /** Protocols observed for this PTY, retained until the PTY exits. */
  protocols: PaneIntegrationProtocol[];
  /** Unix timestamp in milliseconds for the latest observed terminal runtime sequence. */
  lastSequenceAt: number;
  /** Whether shell integration has likely gone stale and fallback inputs are primary again. */
  stale: boolean;
}

export interface PaneAttentionInfo {
  kind: 'awaiting-input' | 'bell';
  source: 'agent-protocol' | 'notification' | 'heuristic';
  observedAt: number;
  expiresAt?: number;
}

export interface PaneAgentInfo {
  known?: 'claude' | 'gemini' | 'codex';
  kind: string | undefined;
  status?: 'running' | 'thinking' | 'awaiting-input' | 'complete';
  source: 'command-line' | 'agent-protocol' | 'heuristic';
  observedAt: number;
}

export interface PaneRuntimeInfo {
  ptyId: string;
  processActivity: PaneProcessActivity;
  /** Foreground command line when activity is running. */
  foregroundCommand?: string;
  foregroundSession: PaneForegroundSession;
  command?: PaneCommandInfo;
  attention?: PaneAttentionInfo;
  agent?: PaneAgentInfo;
  cwd?: string;
  integration: PaneIntegrationInfo;
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
