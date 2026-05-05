import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { TunnelStatus } from '../../shared/types';

export interface TunnelStatusChangedEvent {
  alias: string;
  status: TunnelStatus;
  error?: string;
}

export interface TunnelLogEvent {
  alias: string;
  line: string;
}

export interface TunnelManagerCallbacks {
  onStatusChanged: (event: TunnelStatusChangedEvent) => void;
  onLog: (event: TunnelLogEvent) => void;
}

export type TunnelSpawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface TunnelRuntimeState {
  status: TunnelStatus;
  pid?: number;
  startedAt?: number;
  lastError?: string;
  recentLogs: string[];
}
