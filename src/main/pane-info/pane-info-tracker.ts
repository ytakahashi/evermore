import type { PaneRuntimeInfo } from '../../shared/types';
import { observePaneActivity, ProcessInspector } from './process-inspector';
import {
  DEFAULT_PS_POLL_INTERVAL_MS,
  type PaneInfoTrackerCallbacks,
  type ProcessTableRow,
  type RegisteredPaneProcess,
} from './types';

interface PaneInfoTrackerOptions {
  callbacks: PaneInfoTrackerCallbacks;
  inspector?: Pick<ProcessInspector, 'listProcesses'>;
  now?: () => number;
  pollIntervalMs?: number;
}

/**
 * Tracks dynamic PTY-backed pane activity by polling the foreground process group.
 */
export class PaneInfoTracker {
  private readonly callbacks: PaneInfoTrackerCallbacks;
  private readonly inspector: Pick<ProcessInspector, 'listProcesses'>;
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly processes = new Map<string, RegisteredPaneProcess>();
  private readonly runtimeInfo = new Map<string, PaneRuntimeInfo>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  public constructor(options: PaneInfoTrackerOptions) {
    this.callbacks = options.callbacks;
    this.inspector = options.inspector ?? new ProcessInspector();
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_PS_POLL_INTERVAL_MS;
  }

  /**
   * Registers a PTY id and shell PID for activity tracking.
   */
  public register(ptyId: string, shellPid: number): void {
    this.processes.set(ptyId, { ptyId, shellPid });
    this.upsertInfo({
      ptyId,
      activity: 'idle',
      observedAt: this.now(),
    });
    this.ensurePolling();
    void this.poll();
  }

  /**
   * Stores the latest OSC 7 cwd for future pane-info extensions.
   */
  public notifyCwd(ptyId: string, cwd: string): void {
    const process = this.processes.get(ptyId);
    if (!process) {
      return;
    }

    this.processes.set(ptyId, { ...process, cwd });
  }

  /**
   * Stores the latest command submitted from the terminal input stream for sidebar display.
   *
   * This does not claim to identify the currently executing process. It preserves the user's
   * submitted command line so wrappers and shims (for example `pnpm` resolving to `node .../pnpm`)
   * do not leak into the sidebar label. More accurate shell-history, completion, and cursor-editing
   * support is intentionally left to a future shell integration layer such as OSC 133.
   */
  public notifyCommand(ptyId: string, command: string): void {
    const process = this.processes.get(ptyId);
    const trimmedCommand = command.trim();
    if (!process || !trimmedCommand) {
      return;
    }

    this.processes.set(ptyId, { ...process, lastSubmittedCommand: trimmedCommand });
  }

  /**
   * Unregisters a PTY id and removes its runtime info.
   */
  public unregister(ptyId: string): void {
    this.processes.delete(ptyId);
    this.runtimeInfo.delete(ptyId);

    if (this.processes.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Returns the latest observed info for all tracked panes.
   */
  public list(): PaneRuntimeInfo[] {
    return [...this.runtimeInfo.values()];
  }

  /**
   * Polls the process table once and emits changes.
   */
  public async poll(): Promise<void> {
    if (this.isPolling || this.processes.size === 0) {
      return;
    }

    this.isPolling = true;
    try {
      this.updateFromRows(await this.inspector.listProcesses());
    } catch (error: unknown) {
      if (error instanceof Error) {
        console.warn(`[Evermore] Failed to inspect pane processes: ${error.message}`);
      } else {
        console.warn('[Evermore] Failed to inspect pane processes.');
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Stops all polling and clears runtime state.
   */
  public dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.processes.clear();
    this.runtimeInfo.clear();
  }

  private ensurePolling(): void {
    if (this.pollTimer || this.pollIntervalMs <= 0) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  private updateFromRows(rows: ProcessTableRow[]): void {
    for (const process of this.processes.values()) {
      const observed = observePaneActivity(rows, process.shellPid);
      this.upsertInfo({
        ptyId: process.ptyId,
        activity: observed.activity,
        foregroundCommand:
          observed.activity === 'running'
            ? (process.lastSubmittedCommand ?? observed.foregroundCommand)
            : undefined,
        observedAt: this.now(),
      });
    }
  }

  private upsertInfo(nextInfo: PaneRuntimeInfo): void {
    const currentInfo = this.runtimeInfo.get(nextInfo.ptyId);
    if (
      currentInfo?.activity === nextInfo.activity &&
      currentInfo.foregroundCommand === nextInfo.foregroundCommand
    ) {
      this.runtimeInfo.set(nextInfo.ptyId, {
        ...currentInfo,
        observedAt: nextInfo.observedAt,
      });
      return;
    }

    this.runtimeInfo.set(nextInfo.ptyId, nextInfo);
    this.callbacks.onChanged({ info: nextInfo });
  }
}
