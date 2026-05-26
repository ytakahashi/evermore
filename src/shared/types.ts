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

/**
 * User-attention state raised by an explicit AI agent signal.
 *
 * Only set when an agent protocol signal asks for user input. Cleared by explicit transitions
 * (the next agent status update, the next shell command start, observed user input, or PTY exit)
 * rather than by a timeout. Generic bell / notification sources are intentionally not represented
 * here; if they need to surface in the future, extend `kind` and `source` then.
 */
export interface PaneAttentionInfo {
  kind: 'awaiting-input';
  source: 'agent-protocol';
  observedAt: number;
}

/**
 * Closed union of AI agents that the sidebar maps to a dedicated icon / color.
 *
 * `kind` on {@link PaneAgentInfo} keeps the raw detection value; this type is the curated subset
 * that drives UI affordances.
 */
export type PaneKnownAgent = 'claude' | 'codex' | 'cursor' | 'antigravity';

/**
 * Information about the AI agent running in the pane's foreground.
 *
 * `known` is the closed union used for UI mapping, while `kind` retains the raw basename or
 * protocol value (useful for telemetry and forward compatibility with agents that are not yet
 * promoted to the known set). `status === 'ready'` means the agent TUI is alive and sitting at its
 * input prompt — used both right after launch and after a turn completes, so the UI can map both
 * to the same indicator.
 */
export interface PaneAgentInfo {
  known?: PaneKnownAgent;
  kind: string | undefined;
  status?: 'ready' | 'running' | 'awaiting-input';
  source: 'command-line' | 'agent-protocol';
  observedAt: number;
  /** Optional metadata carried from an agent protocol payload. Unused by command-line detection. */
  detail?: {
    event?: string;
    message?: string;
  };
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
    /**
     * When true, a pane is automatically removed once its PTY exits (e.g., the shell exits via
     * `exit` or Ctrl-D). If the exiting pane is the last pane in its tab, the tab is closed too,
     * unless it is the only tab in the workspace — in that case the pane stays mounted with the
     * `[process exited ...]` message so the workspace never becomes empty.
     */
    closePaneOnExit: boolean;
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
     *
     * Resolution semantics (applied by the main-process settings layer):
     *  - The resolved map carries the merged view of defaults overlaid with user-provided entries.
     *  - An empty-string value (`""`) means "explicitly unbound": the action has no binding even if
     *    the default would have set one. Runtime consumers must treat `""` as "no binding" rather
     *    than attempting to register an empty accelerator.
     *  - On disk, only fields that diverge from defaults are persisted (sparse); an absent key in
     *    the on-disk file means "use the default for that action".
     */
    keybindings: Record<string, string>;
  };
  app: {
    quitConfirm: 'always' | 'never' | 'running-only';
  };
  shellIntegration: {
    /**
     * When true, Evermore injects its zsh shell integration into newly spawned PTYs by overriding
     * `ZDOTDIR` to an Evermore-managed directory that forwards to the user's rc files and then
     * sources the Evermore snippet. Has no effect on shells other than zsh, on already-running
     * PTYs, or on subshells started inside an Evermore PTY.
     */
    autoInject: boolean;
  };
  notifications: {
    /**
     * When true, Evermore raises a macOS notification each time a tracked AI agent transitions
     * into `attention.kind === 'awaiting-input'`. Default false.
     *
     * Requires the agent's hook to be configured and the agent to expose an awaiting-input signal
     * (see Settings > AI Integration). Enabling this without configured hooks results in no
     * notifications.
     */
    aiAgentAwaitingInputEnabled: boolean;
  };
}
