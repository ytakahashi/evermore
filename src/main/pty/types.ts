import type * as nodePty from 'node-pty';

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

export interface PtyManagerCallbacks {
  onData: (event: PtyDataEvent) => void;
  onExit: (event: PtyExitEvent) => void;
}

export type PtySpawn = typeof nodePty.spawn;
