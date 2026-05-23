import type * as nodePty from 'node-pty';
import type { PaneRuntimeSignal } from '../../shared/pane-runtime-signal';
import type { ShellIntegrationInjector } from '../shell-integration/injector';

export interface PtyCreateOptions {
  cwd: string;
  paneId?: string;
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
  /**
   * Absolute working directory the PTY was actually spawned with, after `PtyManager.resolveCwd`
   * has clamped non-existent inputs to the user's home directory.
   *
   * This is the authoritative initial cwd used by `PaneInfoTracker.register` so the first
   * `PaneRuntimeInfo` emission carries a workable cwd before any OSC 7 lifecycle signal arrives.
   */
  cwd: string;
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
  /**
   * Emitted when renderer-originated user input is written to a live PTY.
   */
  onUserInput?: (event: { id: string }) => void;
}

export type PtySpawn = typeof nodePty.spawn;

export interface PtyManagerOptions {
  callbacks: PtyManagerCallbacks;
  spawn?: PtySpawn;
  getHomeDirectory?: () => string;
  /**
   * When provided, the PTY manager asks this injector for env extras (ZDOTDIR + bookkeeping
   * keys) per-PTY so the spawned zsh sources Evermore's shell-integration forwarding scripts.
   * Absent in tests that do not exercise auto-injection.
   */
  shellIntegrationInjector?: ShellIntegrationInjector;
}
