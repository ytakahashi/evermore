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
