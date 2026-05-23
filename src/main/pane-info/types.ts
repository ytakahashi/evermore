import type {
  PaneAgentInfo,
  PaneAttentionInfo,
  PaneCommandInfo,
  PaneForegroundSession,
  PaneIntegrationInfo,
  PaneProcessActivity,
  PaneRuntimeInfo,
} from '../../shared/types';

export const DEFAULT_PS_POLL_INTERVAL_MS = 1500;

export interface PaneInfoChangedEvent {
  info: PaneRuntimeInfo;
}

export interface PaneInfoTrackerCallbacks {
  onChanged: (event: PaneInfoChangedEvent) => void;
}

export interface RegisteredPaneProcess {
  ptyId: string;
  shellPid: number;
  cwd?: string;
  fallbackSubmittedCommand?: string;
  shellIntegrationCommandLine?: string;
  currentCommand?: PaneCommandInfo;
  lastCommand?: PaneCommandInfo;
  foregroundSession: PaneForegroundSession;
  integration: PaneIntegrationInfo;
  attention?: PaneAttentionInfo;
  agent?: PaneAgentInfo;
  lastForegroundCommand?: string;
  lastForegroundArgs?: string;
  lastProcessActivity: PaneProcessActivity;
  missedPsCommandStarts: number;
  /**
   * Set when a local shell-integration command line introduced an `ssh` invocation but the
   * process-table poll has not yet classified the foreground session as `ssh`. While active, the
   * tracker treats subsequent shell-integration signals as remote-origin and suppresses local
   * state updates that they would otherwise drive. Released on the next process-table observation,
   * after which the regular `foregroundSession.kind === 'ssh'` guard takes over.
   */
  sshShellLifecycleActive: boolean;
}

export interface ProcessTableRow {
  pid: number;
  ppid: number;
  pgid: number;
  tpgid: number;
  command: string;
  args: string;
}

export interface ObservedPaneActivity {
  activity: PaneProcessActivity;
  foregroundCommand?: string;
  foregroundArgs?: string;
}
