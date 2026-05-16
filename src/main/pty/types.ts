import type * as nodePty from 'node-pty';
import type { PaneRuntimeSignal } from '../../shared/pane-runtime-signal';

export interface PtyCreateOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface PtyDataEvent {
  id: string;
  data: string;
}

export interface PtyExitEvent {
  id: string;
  code: number;
}

export interface PtyCreateEvent {
  id: string;
  pid: number;
}

export interface PtyDisposeEvent {
  id: string;
}

export interface PtySignalEvent {
  id: string;
  signal: PaneRuntimeSignal;
}

export interface PtyManagerCallbacks {
  onData: (event: PtyDataEvent) => void;
  onExit: (event: PtyExitEvent) => void;
  onCreate?: (event: PtyCreateEvent) => void;
  onDispose?: (event: PtyDisposeEvent) => void;
  /**
   * Emitted when the terminal signal parser observes a known OSC sequence.
   */
  onSignal?: (event: PtySignalEvent) => void;
}

export type PtySpawn = typeof nodePty.spawn;
