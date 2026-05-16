import type {
  PaneRuntimeSignal,
  PaneRuntimeSignalLifecycleSource,
} from '../../shared/pane-runtime-signal';
import type {
  PaneIntegrationInfo,
  PaneIntegrationProtocol,
  PaneProcessActivity,
  PaneRuntimeInfo,
} from '../../shared/types';
import { classifyForegroundSession } from './foreground-session';
import { isIntegrationStale } from './integration-staleness';
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
  private pollIntervalMs: number;
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
    const process: RegisteredPaneProcess = {
      ptyId,
      shellPid,
      foregroundSession: { kind: 'none' },
      integration: createInitialIntegration(),
      lastProcessActivity: 'idle',
      missedPsCommandStarts: 0,
    };
    this.processes.set(ptyId, process);
    this.recomputeInfo(process, {
      emit: true,
      observedAt: this.now(),
    });
    this.ensurePolling();
    void this.poll();
  }

  /**
   * Applies a terminal runtime signal observed from PTY output.
   */
  public applySignal(ptyId: string, signal: PaneRuntimeSignal): void {
    const process = this.processes.get(ptyId);
    if (!process) {
      return;
    }

    const now = this.now();
    switch (signal.type) {
      case 'cwd':
        this.applyCwd(process, signal.cwd, now);
        break;

      case 'shell-prompt-start':
        this.applyLifecycleProtocol(process, signal.source, now);
        // A/B are lifecycle signals too, so under the SSH invariant the tracker must not touch
        // local currentCommand/lastCommand state from remote prompt markers. In practice
        // currentCommand is undefined while ssh is the foreground process, but guarding here keeps
        // the invariant explicit instead of relying on finishCurrentCommand's early return.
        if (process.foregroundSession.kind !== 'ssh') {
          this.finishCurrentCommand(process, now);
        }
        break;

      case 'shell-prompt-end':
        this.applyLifecycleProtocol(process, signal.source, now);
        break;

      case 'shell-command-started':
        this.applyLifecycleProtocol(process, signal.source, now);
        if (process.foregroundSession.kind !== 'ssh') {
          process.currentCommand = {
            line: process.shellIntegrationCommandLine ?? '',
            startedAt: now,
            source: 'shell-integration',
          };
          process.missedPsCommandStarts = 0;
        }
        break;

      case 'shell-command-finished':
        this.applyLifecycleProtocol(process, signal.source, now);
        if (process.foregroundSession.kind !== 'ssh') {
          this.finishCurrentCommand(process, now, signal.exitCode);
        }
        break;

      case 'shell-command-line':
        appendProtocolOnce(process.integration, signal.source);
        process.integration.shell = true;
        process.integration.lastSequenceAt = now;
        if (process.foregroundSession.kind !== 'ssh') {
          process.shellIntegrationCommandLine = signal.command;
          process.missedPsCommandStarts = 0;
        }
        break;
    }

    this.recomputeInfo(process, { emit: true, observedAt: now });
  }

  /**
   * Stores the latest OSC 7 cwd observed by the renderer-side terminal parser.
   *
   * Delegates to {@link applySignal} so renderer-driven and main-process-driven OSC 7 inputs share
   * the same merge rules (in particular, the SSH skip and the integration protocol bookkeeping).
   * Remove this method once the renderer OSC 7 handler is retired in Phase 4.
   */
  public notifyCwd(ptyId: string, cwd: string): void {
    this.applySignal(ptyId, { type: 'cwd', source: 'osc7', cwd });
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

    process.fallbackSubmittedCommand = trimmedCommand;
    this.recomputeInfo(process, { emit: true, observedAt: this.now() });
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
   * Updates the process-table polling interval. Values <= 0 disable recurring polling while keeping
   * already registered panes and their latest runtime info intact.
   */
  public setPollIntervalMs(pollIntervalMs: number): void {
    const nextPollIntervalMs = Number.isFinite(pollIntervalMs) ? pollIntervalMs : 0;
    if (this.pollIntervalMs === nextPollIntervalMs) {
      return;
    }

    this.pollIntervalMs = nextPollIntervalMs;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.ensurePolling();
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
      const previousActivity = process.lastProcessActivity;
      const foregroundSession = classifyForegroundSession(
        observed.activity,
        observed.foregroundArgs,
      );

      if (
        process.integration.shell &&
        previousActivity === 'idle' &&
        observed.activity === 'running' &&
        foregroundSession.kind !== 'ssh'
      ) {
        process.missedPsCommandStarts += 1;
      }

      // The running→idle ps transition is the third command-cycle cleanup path alongside 133;D
      // and 133;A. The currentCommand guard is intentionally absent so that
      // shellIntegrationCommandLine is cleared even when 633;E arrived without a matching 133;C.
      if (previousActivity === 'running' && observed.activity === 'idle') {
        this.finishCurrentCommand(process, this.now());
      }

      process.lastProcessActivity = observed.activity;
      process.lastForegroundCommand = observed.foregroundCommand;
      process.lastForegroundArgs = observed.foregroundArgs;
      process.foregroundSession = foregroundSession;
      this.recomputeInfo(process, { emit: true, observedAt: this.now() });
    }
  }

  private applyCwd(process: RegisteredPaneProcess, cwd: string, now: number): void {
    if (process.foregroundSession.kind === 'ssh') {
      return;
    }

    process.cwd = cwd;
    appendProtocolOnce(process.integration, 'osc7');
    process.integration.lastSequenceAt = now;
  }

  private applyLifecycleProtocol(
    process: RegisteredPaneProcess,
    source: PaneRuntimeSignalLifecycleSource,
    now: number,
  ): void {
    appendProtocolOnce(process.integration, source);
    process.integration.shell = true;
    process.integration.lastSequenceAt = now;
  }

  private finishCurrentCommand(
    process: RegisteredPaneProcess,
    finishedAt: number,
    exitCode?: number,
  ): void {
    if (process.currentCommand) {
      process.lastCommand = {
        ...process.currentCommand,
        finishedAt,
        ...(exitCode === undefined ? {} : { exitCode }),
      };
      process.currentCommand = undefined;
    }
    // Always run, even when currentCommand was undefined: malformed sequences such as 633;E
    // arriving without a matching 133;C would otherwise leave a stale shellIntegrationCommandLine
    // that outranks freshly observed ps foreground processes (notably `ssh`) at display time.
    this.clearShellIntegrationCommandLine(process);
  }

  private clearShellIntegrationCommandLine(process: RegisteredPaneProcess): void {
    // The OSC 633;E command line is tied to the command lifecycle that has just ended. The next
    // command's 633;E repopulates this before its 133;C arrives.
    process.shellIntegrationCommandLine = undefined;
  }

  private recomputeInfo(
    process: RegisteredPaneProcess,
    options: { emit: boolean; observedAt: number },
  ): void {
    const integration = {
      ...process.integration,
      protocols: [...process.integration.protocols],
      stale: isIntegrationStale(
        process.integration,
        process.missedPsCommandStarts,
        options.observedAt,
      ),
    };
    process.integration = integration;

    const processActivity = this.computeProcessActivity(process);
    const foregroundCommand = this.computeForegroundCommand(process, integration.stale);
    // Prefer the in-flight command so the sidebar reflects the live shell-integration command
    // before its `D` arrives; otherwise fall back to the most recent finished command.
    const activeCommand = process.currentCommand ?? process.lastCommand;
    const nextInfo: PaneRuntimeInfo = {
      ptyId: process.ptyId,
      activity: processActivity,
      processActivity,
      foregroundSession:
        processActivity === 'idle' ? { kind: 'none' } : { ...process.foregroundSession },
      integration,
      observedAt: options.observedAt,
      ...(foregroundCommand ? { foregroundCommand } : {}),
      ...(activeCommand ? { command: activeCommand } : {}),
      ...(process.cwd ? { cwd: process.cwd } : {}),
      ...(process.attention ? { attention: process.attention } : {}),
      ...(process.agent ? { agent: process.agent } : {}),
    };

    this.upsertInfo(nextInfo, options.emit);
  }

  private computeProcessActivity(process: RegisteredPaneProcess): PaneProcessActivity {
    if (process.foregroundSession.kind === 'ssh' && process.lastProcessActivity === 'running') {
      return 'running';
    }

    if (process.integration.shell && !process.integration.stale && process.currentCommand) {
      return 'running';
    }

    return process.lastProcessActivity;
  }

  private computeForegroundCommand(
    process: RegisteredPaneProcess,
    integrationStale: boolean,
  ): string | undefined {
    if (process.lastProcessActivity !== 'running' && !process.currentCommand) {
      return undefined;
    }

    if (integrationStale) {
      return (
        process.fallbackSubmittedCommand ??
        process.lastForegroundCommand ??
        process.shellIntegrationCommandLine
      );
    }

    return (
      process.shellIntegrationCommandLine ??
      process.fallbackSubmittedCommand ??
      process.lastForegroundCommand
    );
  }

  private upsertInfo(nextInfo: PaneRuntimeInfo, emit: boolean): void {
    const currentInfo = this.runtimeInfo.get(nextInfo.ptyId);
    if (currentInfo && areRuntimeInfosEquivalent(currentInfo, nextInfo)) {
      this.runtimeInfo.set(nextInfo.ptyId, {
        ...currentInfo,
        observedAt: nextInfo.observedAt,
      });
      return;
    }

    this.runtimeInfo.set(nextInfo.ptyId, nextInfo);
    if (emit) {
      this.callbacks.onChanged({ info: nextInfo });
    }
  }
}

function createInitialIntegration(): PaneIntegrationInfo {
  return {
    shell: false,
    protocols: [],
    lastSequenceAt: 0,
    stale: false,
  };
}

function appendProtocolOnce(
  integration: PaneIntegrationInfo,
  protocol: PaneIntegrationProtocol,
): void {
  if (!integration.protocols.includes(protocol)) {
    integration.protocols.push(protocol);
  }
}

function areRuntimeInfosEquivalent(left: PaneRuntimeInfo, right: PaneRuntimeInfo): boolean {
  return (
    left.processActivity === right.processActivity &&
    left.foregroundCommand === right.foregroundCommand &&
    left.foregroundSession.kind === right.foregroundSession.kind &&
    left.foregroundSession.details === right.foregroundSession.details &&
    left.cwd === right.cwd &&
    areCommandsEquivalent(left.command, right.command) &&
    areIntegrationsEquivalent(left.integration, right.integration) &&
    JSON.stringify(left.attention) === JSON.stringify(right.attention) &&
    JSON.stringify(left.agent) === JSON.stringify(right.agent)
  );
}

function areCommandsEquivalent(
  left: PaneRuntimeInfo['command'],
  right: PaneRuntimeInfo['command'],
): boolean {
  return (
    left?.line === right?.line &&
    left?.startedAt === right?.startedAt &&
    left?.finishedAt === right?.finishedAt &&
    left?.exitCode === right?.exitCode &&
    left?.source === right?.source
  );
}

function areIntegrationsEquivalent(left: PaneIntegrationInfo, right: PaneIntegrationInfo): boolean {
  return (
    left.shell === right.shell &&
    left.lastSequenceAt === right.lastSequenceAt &&
    left.stale === right.stale &&
    left.protocols.length === right.protocols.length &&
    left.protocols.every((protocol, index) => protocol === right.protocols[index])
  );
}
