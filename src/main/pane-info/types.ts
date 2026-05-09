import type { PaneRuntimeInfo } from '../../shared/types';

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
  lastSubmittedCommand?: string;
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
  activity: PaneRuntimeInfo['activity'];
  foregroundCommand?: string;
}
