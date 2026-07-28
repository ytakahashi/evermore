import {
  AGENT_USER_PROMPT_SUBMIT_EVENT,
  type EvermoreAgentEvent,
  type PaneRuntimeSignal,
  type PaneRuntimeSignalLifecycleSource,
} from '../../shared/pane-runtime-signal';
import type {
  PaneAgentInfo,
  PaneIntegrationInfo,
  PaneIntegrationProtocol,
  PaneProcessActivity,
  PaneRuntimeInfo,
} from '../../shared/types';
import {
  AGENT_DETAIL_ACTIVITY_LABEL_MAX_CHARS,
  AGENT_DETAIL_MESSAGE_MAX_CHARS,
  AGENT_DETAIL_TOOL_NAME_MAX_CHARS,
  AGENT_USER_PROMPT_MAX_CHARS,
} from '../../shared/pane-integration-constants';
import { sanitizeAgentText } from '../../shared/text/sanitize-agent-text';
import { createSilentLogger, type Logger } from '../logging/logger';
import { detectAgentFromCommand } from './agent-detection';
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
  /**
   * Logger for diagnostic observations such as process-inspection failures. Optional so tests
   * can omit it and inherit a silent default.
   */
  logger?: Logger;
}

/**
 * Tracks dynamic PTY-backed pane activity by polling the foreground process group.
 */
export class PaneInfoTracker {
  private readonly callbacks: PaneInfoTrackerCallbacks;
  private readonly inspector: Pick<ProcessInspector, 'listProcesses'>;
  private readonly now: () => number;
  private readonly logger: Logger;
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
    this.logger = options.logger ?? createSilentLogger();
  }

  /**
   * Registers a PTY id and shell PID for activity tracking.
   *
   * `cwd` must be the absolute path the PTY was actually spawned with (i.e. `resolveCwd` output).
   * It is seeded into `PaneRuntimeInfo.cwd` on the first emit so the sidebar and workspace cwd
   * have a usable value before any OSC 7 lifecycle signal arrives. Callers must not pass an empty
   * string; the tracker treats the value as opaque and does not validate it.
   */
  public register(ptyId: string, shellPid: number, cwd: string): void {
    const process: RegisteredPaneProcess = {
      ptyId,
      shellPid,
      cwd,
      foregroundSession: { kind: 'none' },
      integration: createInitialIntegration(),
      lastProcessActivity: 'idle',
      missedPsCommandStarts: 0,
      sshShellLifecycleActive: false,
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
        // applyCwd returns false when the SSH invariant skips the write. Bail out before the
        // recomputeInfo call below so a remote shell hammering OSC 7 during an ssh session does
        // not pay for an emit attempt per signal: the equivalence check would suppress the emit,
        // but the recompute itself still allocates a fresh PaneRuntimeInfo.
        if (!this.applyCwd(process, signal.cwd, now)) {
          return;
        }
        break;

      case 'shell-prompt-start':
        this.applyLifecycleProtocol(process, signal.source, now);
        // A/B are lifecycle signals too, so under the SSH invariant the tracker must not touch
        // local currentCommand/lastCommand state from remote prompt markers. In practice
        // currentCommand is undefined while ssh is the foreground process, but guarding here keeps
        // the invariant explicit instead of relying on finishCurrentCommand's early return.
        if (!isInSshShellLifecycle(process)) {
          this.finishCurrentCommand(process, now);
          this.clearAgentProtocolState(process);
        }
        break;

      case 'shell-prompt-end':
        this.applyLifecycleProtocol(process, signal.source, now);
        break;

      case 'shell-command-started':
        this.applyLifecycleProtocol(process, signal.source, now);
        if (!isInSshShellLifecycle(process)) {
          this.clearAgentProtocolState(process);
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
        if (!isInSshShellLifecycle(process)) {
          this.finishCurrentCommand(process, now, signal.exitCode);
        }
        break;

      case 'shell-command-line':
        appendProtocolOnce(process.integration, signal.source);
        process.integration.shell = true;
        process.integration.lastSequenceAt = now;
        if (!isInSshShellLifecycle(process)) {
          process.shellIntegrationCommandLine = signal.command;
          process.missedPsCommandStarts = 0;
          if (isSshCommandLine(signal.command)) {
            // The local shell is about to launch ssh; subsequent shell-integration signals are
            // assumed to originate from the remote shell until the process-table poll catches up
            // and the regular foregroundSession.kind === 'ssh' guard takes over. Pre-populate
            // currentCommand so the sidebar reflects the ssh invocation immediately, since the
            // matching local shell-command-started will be skipped by the same guard.
            process.sshShellLifecycleActive = true;
            process.currentCommand = {
              line: signal.command,
              startedAt: now,
              source: 'shell-integration',
            };
          }
        }
        break;

      case 'agent-event':
        this.applyAgentEvent(process, signal.event, now);
        break;
    }

    this.recomputeInfo(process, { emit: true, observedAt: now });
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
   * Observes renderer-originated input written to a PTY.
   *
   * User input means an explicit approval/input prompt has been answered. The answer may have been
   * approval or rejection, and that result is not observable through the PTY write path, so the
   * conservative fallback is to leave the agent alive but return it to `ready`. Later explicit
   * agent protocol signals can still move it back to `running` or confirm `ready`.
   *
   * We intentionally do not filter by key kind: navigation/control keys also mean the user has
   * noticed the awaiting-input prompt. This can briefly render awaiting-input -> ready -> running
   * when a user navigates before approving, but the next explicit agent signal converges the state.
   */
  public notifyUserInput(ptyId: string): void {
    const process = this.processes.get(ptyId);
    // The attention `kind` comparison is structurally redundant today because
    // PaneAttentionInfo.kind is the literal 'awaiting-input'. It is kept so that future kinds
    // added to the union cannot accidentally be cleared by user input through this path.
    const hasAwaitingInputAttention = process?.attention?.kind === 'awaiting-input';
    const hasAwaitingInputAgent = process?.agent?.status === 'awaiting-input';
    if (!process || (!hasAwaitingInputAttention && !hasAwaitingInputAgent)) {
      return;
    }

    const observedAt = this.now();
    if (hasAwaitingInputAttention) {
      process.attention = undefined;
    }
    if (hasAwaitingInputAgent && process.agent) {
      process.agent = {
        ...process.agent,
        status: 'ready',
        observedAt,
      };
    }
    this.recomputeInfo(process, { emit: true, observedAt });
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
      this.logger.warn('Failed to inspect pane processes', error);
      // A prompt received during this poll reserved a one-observation reprieve against it. The poll
      // produced no observation, so there is nothing left for the reprieve to skip; leaving it set
      // would spend it on the next poll instead — one that started after the prompt and is
      // therefore authoritative. That delay is enough for an agent to exit and relaunch unnoticed,
      // which would resurrect the previous session's prompt.
      this.releaseUserPromptPollReprieve();
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
      const observedAt = this.now();
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
        this.finishCurrentCommand(process, observedAt);
      }

      if (process.sshShellLifecycleActive && foregroundSession.kind !== 'ssh') {
        // The early SSH guard is active only until ps catches up. If the first ps observation does
        // not confirm ssh, the local launch failed, exited immediately, or moved to a different
        // foreground state; close the pre-populated ssh command before releasing the guard.
        this.finishCurrentCommand(process, observedAt);
      }

      process.lastProcessActivity = observed.activity;
      process.lastForegroundCommand = observed.foregroundCommand;
      process.lastForegroundArgs = observed.foregroundArgs;
      process.foregroundSession = foregroundSession;
      // ps now has its own observation of the foreground state, so the early-detection guard set
      // by an ssh shell-command-line is no longer needed. If ps confirms ssh, the
      // foregroundSession-based guards take over; if ps reports anything else, the local ssh
      // launch either failed or already exited and the flag must release to avoid suppressing
      // future legitimate updates.
      process.sshShellLifecycleActive = false;
      // Must run before the recompute: the recompute builds the snapshot that gets emitted, so a
      // discard applied afterwards would still ship the stale prompt and leave it on screen until
      // some later change happened to trigger another emit.
      this.reconcileUserPromptWithObservation(process, observed.foregroundArgs);
      this.recomputeInfo(process, { emit: true, observedAt });
    }
  }

  /**
   * Clears the in-flight-poll reprieve on every pane after a poll failed to deliver rows.
   *
   * Pairs with the flag set in `captureUserPrompt`: the reprieve is defined against one specific
   * poll, so it must be released whenever that poll ends without reaching `updateFromRows()`.
   */
  private releaseUserPromptPollReprieve(): void {
    for (const process of this.processes.values()) {
      if (process.userPrompt?.ignoreInFlightPoll) {
        process.userPrompt = { ...process.userPrompt, ignoreInFlightPoll: false };
      }
    }
  }

  /**
   * Drops the retained prompt when the process table no longer shows the agent it was sent to.
   *
   * The check reads the raw ps observation rather than `process.agent` on purpose. `computeAgent()`
   * keeps an `agent-protocol` agent in place regardless of what ps reports, until a shell command
   * boundary clears it — an intentional rule that makes protocol status outrank command-line
   * detection. Reusing `process.agent` here would inherit that stickiness and let a prompt survive
   * both a plain command taking over the pane and a switch to a different agent.
   *
   * `detectAgentFromCommand()` accepts a process-table `args` string, so the foreground args pass
   * through unchanged.
   */
  private reconcileUserPromptWithObservation(
    process: RegisteredPaneProcess,
    foregroundArgs: string | undefined,
  ): void {
    const userPrompt = process.userPrompt;
    if (!userPrompt) {
      return;
    }

    if (userPrompt.ignoreInFlightPoll) {
      // This observation predates the prompt, so it proves nothing about the agent. Consume the
      // reprieve — it is worth exactly one observation — and let the next poll decide.
      //
      // Pointing at "the one observation to skip" with a boolean is only sound because `poll()`
      // rejects re-entry while `isPolling` is set and is the sole caller of `updateFromRows()`, so
      // at most one poll is ever in flight. Allowing concurrent polls would break that and require
      // a poll sequence number instead.
      process.userPrompt = { ...userPrompt, ignoreInFlightPoll: false };
      return;
    }

    const observedIdentity = toAgentIdentity(detectAgentFromCommand(foregroundArgs));
    if (observedIdentity !== userPrompt.agentIdentity) {
      process.userPrompt = undefined;
    }
  }

  /**
   * Applies an OSC 7 cwd observation. Returns `false` when the SSH invariant skipped the write so
   * the caller can also skip the surrounding `recomputeInfo` and avoid a no-op emit cycle.
   */
  private applyCwd(process: RegisteredPaneProcess, cwd: string, now: number): boolean {
    if (process.foregroundSession.kind === 'ssh') {
      return false;
    }

    process.cwd = cwd;
    appendProtocolOnce(process.integration, 'osc7');
    process.integration.lastSequenceAt = now;
    return true;
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

  private applyAgentEvent(
    process: RegisteredPaneProcess,
    event: EvermoreAgentEvent,
    now: number,
  ): void {
    appendProtocolOnce(process.integration, 'osc777');
    appendProtocolOnce(process.integration, 'evermore');
    process.integration.lastSequenceAt = now;

    if (isInSshShellLifecycle(process)) {
      return;
    }

    const status = event.status === 'complete' ? 'ready' : event.status;
    const nextAgent: PaneAgentInfo = {
      ...agentInfoFromKind(event.agent),
      status,
      source: 'agent-protocol',
      observedAt: this.computeAgentEventObservedAt(process.agent, event.agent, status, now),
      ...agentDetailFromEvent(event),
    };

    process.agent = nextAgent;
    process.attention =
      status === 'awaiting-input'
        ? {
            kind: 'awaiting-input',
            source: 'agent-protocol',
            observedAt: now,
          }
        : undefined;

    this.captureUserPrompt(process, event);
  }

  /**
   * Records the prompt carried by a prompt-submitting agent event.
   *
   * Restricted to `user_prompt_submit` so that only text the user actually typed can reach the UI;
   * the hook helper enforces the same restriction on its side. Events without a usable prompt leave
   * the previous one alone rather than clearing it — a `PostToolUse` in the middle of a turn must
   * not erase the instruction that started that turn.
   */
  private captureUserPrompt(process: RegisteredPaneProcess, event: EvermoreAgentEvent): void {
    if (event.event !== AGENT_USER_PROMPT_SUBMIT_EVENT) {
      return;
    }

    const text = sanitizeAgentText(event.userPrompt, AGENT_USER_PROMPT_MAX_CHARS);
    if (!text) {
      return;
    }

    // Run the protocol's agent name through the same mapping the agent slot uses, so the stored
    // identity is directly comparable with what command-line detection produces later.
    const agentIdentity = toAgentIdentity(agentInfoFromKind(event.agent));
    if (!agentIdentity) {
      return;
    }

    process.userPrompt = {
      text,
      agentIdentity,
      // A poll that started before this moment may be looking at a process table without the agent
      // in it. Flag it so `updateFromRows` skips exactly that one observation instead of treating
      // its stale snapshot as proof that the session already ended.
      ignoreInFlightPoll: this.isPolling,
    };
  }

  private computeAgentEventObservedAt(
    previous: PaneAgentInfo | undefined,
    kind: string,
    status: PaneAgentInfo['status'],
    now: number,
  ): number {
    if (
      previous?.source === 'agent-protocol' &&
      previous.kind === kind &&
      previous.status === status
    ) {
      return previous.observedAt;
    }

    return now;
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

  private clearAgentProtocolState(process: RegisteredPaneProcess): void {
    process.agent = undefined;
    process.attention = undefined;
    // The shell has taken the foreground back, so whatever agent the prompt was addressed to is
    // gone. This is one of the two explicit transitions allowed to drop the prompt.
    process.userPrompt = undefined;
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
    if (processActivity === 'idle' || isInSshShellLifecycle(process)) {
      // computeAgent re-derives process.agent; process.attention has no equivalent helper,
      // so the idle/ssh clear lives here.
      process.attention = undefined;
    }
    if (isInSshShellLifecycle(process)) {
      // Moving into an ssh session takes the pane out of local agent classification entirely, so
      // the prompt goes with it. Note this deliberately does not extend to the `idle` case above:
      // a signal-driven recompute routinely observes `idle` in the window before ps notices the
      // agent, and dropping the prompt there would lose it for the whole turn.
      process.userPrompt = undefined;
    }
    process.agent = this.computeAgent(
      process,
      processActivity,
      foregroundCommand,
      options.observedAt,
    );
    const userPrompt = resolveEmittableUserPrompt(process);
    const nextInfo: PaneRuntimeInfo = {
      ptyId: process.ptyId,
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
      ...(userPrompt ? { userPrompt } : {}),
    };

    this.upsertInfo(nextInfo, options.emit);
  }

  /**
   * Derives the agent slot from the foreground command line.
   *
   * Returns `undefined` when the pane is idle or while an SSH session is in the foreground — the
   * remote shell may legitimately invoke an agent, but the local pane's classification input is
   * limited to local foreground args (per the same invariant that keeps `foregroundSession` stable
   * across SSH). A future remote-agent surface would need its own field rather than overloading
   * this one.
   *
   * When the detection result matches the previous snapshot, the prior `observedAt` is preserved
   * so the renderer does not re-render on signal events that did not change the agent identity.
   * Agent transitions that skip a shell-prompt-start boundary (e.g. exiting `claude` and starting
   * `codex` in the same prompt while shell integration is unavailable) are intentionally not
   * specialized here: the helper simply overwrites the slot on every recompute, so the indicator
   * does not visibly reset between back-to-back known agents.
   */
  private computeAgent(
    process: RegisteredPaneProcess,
    processActivity: PaneProcessActivity,
    foregroundCommand: string | undefined,
    observedAt: number,
  ): PaneAgentInfo | undefined {
    if (processActivity === 'idle' || isInSshShellLifecycle(process)) {
      return undefined;
    }

    if (process.agent?.source === 'agent-protocol') {
      return process.agent;
    }

    const detected = detectAgentFromCommand(foregroundCommand);
    if (!detected) {
      return undefined;
    }

    const previous = process.agent;
    if (
      previous &&
      previous.known === detected.known &&
      previous.kind === detected.kind &&
      previous.status === 'ready' &&
      previous.source === 'command-line'
    ) {
      return previous;
    }

    return {
      known: detected.known,
      kind: detected.kind,
      status: 'ready',
      source: 'command-line',
      observedAt,
    };
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

function agentInfoFromKind(kind: string): Pick<PaneAgentInfo, 'known' | 'kind'> {
  switch (kind) {
    case 'claude':
      return { known: 'claude', kind };
    case 'codex':
      return { known: 'codex', kind };
    case 'cursor':
    case 'cursor-agent':
    case 'agent':
      return { known: 'cursor', kind };
    case 'antigravity':
    case 'agy':
      return { known: 'antigravity', kind };
    default:
      return { kind };
  }
}

function agentDetailFromEvent(event: EvermoreAgentEvent): Partial<Pick<PaneAgentInfo, 'detail'>> {
  const message = event.message
    ? sanitizeAgentText(event.message, AGENT_DETAIL_MESSAGE_MAX_CHARS)
    : '';
  const activityLabel = event.activityLabel
    ? sanitizeAgentText(event.activityLabel, AGENT_DETAIL_ACTIVITY_LABEL_MAX_CHARS)
    : '';
  const toolName = event.toolName
    ? sanitizeAgentText(event.toolName, AGENT_DETAIL_TOOL_NAME_MAX_CHARS)
    : '';

  const detail = {
    ...(event.event ? { event: event.event } : {}),
    ...(message ? { message } : {}),
    ...(activityLabel ? { activityLabel } : {}),
    ...(toolName ? { toolName } : {}),
  };

  return Object.keys(detail).length > 0 ? { detail } : {};
}

/**
 * Returns the retained prompt only when it belongs to the agent the pane currently shows.
 *
 * This is the second of the two guards protecting the prompt from being attributed to the wrong
 * session, and it covers what the process-table check cannot: the interval inside a single poll
 * period. Leaving `claude` and starting `codex` there produces a protocol event that swaps
 * `process.agent` immediately, while ps has not yet reported anything — without this comparison the
 * prompt written for Claude would appear under the Codex card.
 *
 * Conversely, while ps has not yet caught up to a freshly launched agent, `process.agent` is
 * `undefined` and the prompt simply stays unemitted until the agent is confirmed, rather than being
 * thrown away.
 */
function resolveEmittableUserPrompt(process: RegisteredPaneProcess): string | undefined {
  const userPrompt = process.userPrompt;
  if (!userPrompt || toAgentIdentity(process.agent) !== userPrompt.agentIdentity) {
    return undefined;
  }

  return userPrompt.text;
}

/**
 * Reduces an agent to the identity used when deciding whether two observations describe the same
 * agent session.
 *
 * Prefers `known`, the curated vocabulary both the hook protocol and command-line detection map
 * into, so `cursor` and `cursor-agent` — or `antigravity` and `agy` — are recognized as one agent.
 * Falls back to the raw `kind` for agents outside that set: those have no shared vocabulary to
 * appeal to, so two sources agree only when they report the identical string. Returning `undefined`
 * for a missing agent keeps "nothing observed" distinct from every real identity, rather than
 * letting two unknowns compare equal.
 */
function toAgentIdentity(
  agent: Pick<PaneAgentInfo, 'known' | 'kind'> | undefined,
): string | undefined {
  return agent?.known ?? agent?.kind;
}

/**
 * Returns whether the pane is currently inside an ssh-bound shell-integration lifecycle.
 *
 * This collapses the two SSH suppression sources — the process-table classification and the
 * shell-command-line early detection — so each call site reads as a single SSH check.
 */
function isInSshShellLifecycle(process: RegisteredPaneProcess): boolean {
  return process.foregroundSession.kind === 'ssh' || process.sshShellLifecycleActive;
}

/**
 * Returns whether `commandLine` invokes `ssh` as its leading command token.
 *
 * Used by the shell-command-line handler to flag the pane as ssh-bound before the next
 * process-table poll classifies the foreground session. The match is intentionally narrow — only
 * the literal `ssh` basename — so aliases or wrappers that resolve to ssh under the hood
 * (`ss host`, custom scripts) are not detected here; for those cases the process-table classifier
 * still picks them up once ps observes the resolved path.
 */
function isSshCommandLine(commandLine: string): boolean {
  const trimmed = commandLine.trim();
  if (!trimmed) {
    return false;
  }
  const firstToken = trimmed.split(/\s+/, 1)[0] ?? '';
  const slash = firstToken.lastIndexOf('/');
  const basename = slash >= 0 ? firstToken.slice(slash + 1) : firstToken;
  return basename === 'ssh';
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
    // Without this comparison a turn whose only change is a new prompt would be treated as an
    // unchanged snapshot, and the emit that carries the prompt to the renderer would be suppressed.
    left.userPrompt === right.userPrompt &&
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
