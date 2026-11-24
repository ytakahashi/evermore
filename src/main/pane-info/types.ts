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
  shellIntegrationCommandLine?: string;
  currentCommand?: PaneCommandInfo;
  lastCommand?: PaneCommandInfo;
  foregroundSession: PaneForegroundSession;
  integration: PaneIntegrationInfo;
  attention?: PaneAttentionInfo;
  agent?: PaneAgentInfo;
  /**
   * Hook-reported state of the agent session currently running in the pane.
   *
   * Retention differs from every other agent-derived field here: a prompt arrives once per turn and
   * is never re-sent, so anything that drops the record drops it for the rest of the turn.
   * Signal-driven recomputes therefore never clear this slot — only process-table observations and
   * explicit transitions out of the agent (shell lifecycle, ssh, PTY teardown) do.
   */
  agentSession?: AgentSessionRecord;
  lastForegroundCommand?: string;
  lastForegroundArgs?: string;
  /** Foreground process group from the latest observation; unset while the pane is idle. */
  lastForegroundPgid?: number;
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

/**
 * Agent session state that `PaneInfoTracker` keeps per pane on behalf of the renderer.
 *
 * Held as a record rather than the bare strings that reach the renderer because the tracker needs
 * to know *which* agent session the values belong to before it can decide whether they are still
 * current. Every value derived from the session shares the record's lifetime, so discarding the
 * record is the single way to drop them all.
 */
export interface AgentSessionRecord {
  /**
   * Latest prompt the user submitted to this session. Unset when the record was created from a
   * title-only event, for example for a session that started before Evermore did.
   */
  prompt?: string;
  /** Latest session title the agent's hook reported for this session. */
  title?: string;
  /**
   * Hook-reported session id. Undefined when the event that created the record carried none (an
   * agent whose hook never sends one, or a payload degraded to its minimal form).
   *
   * Once the record holds a prompt, only prompt-carrying events may fill it in: other events can
   * come from a subagent with its own id, and adopting that id would make the parent's next prompt
   * look like a different session. A record created from a title alone has not identified its
   * session yet, so any title event of the same agent replaces both the title and this id.
   */
  sessionId?: string;
  /**
   * Identity of the agent the session belongs to.
   *
   * It decides whether the record is emitted (it must match the pane's current agent) and whether
   * the last observed foreground process group may be adopted when the record is built. It is not a
   * discard condition: `reconcileAgentSessionWithObservation()` checks whether the session is still
   * alive by comparing `foregroundPgid` only, because a launcher such as `node .../bin/codex` hides
   * the agent's name from command-line detection.
   *
   * Deliberately not the raw `kind`. The two sources spell the same agent differently — the hook
   * protocol reports `cursor` / `antigravity` while the process table yields the executable
   * basenames `cursor-agent` / `agent` / `agy` — so comparing raw kinds would mark every Cursor and
   * Antigravity session as a mismatch. This holds the normalized form both sides agree on.
   */
  agentIdentity: string;
  /**
   * Foreground process group the session runs in, once one has been observed.
   *
   * This is what decides whether the agent session is still alive. It is left unset when the
   * process table has not yet caught up to a freshly launched agent, and bound on the first
   * observation that finds the pane running; from then on a different process group means a
   * different job, and the record is dropped.
   */
  foregroundPgid?: number;
  /**
   * Set when a process-table poll was already in flight as the record was (re)built. Such a poll
   * may have sampled the process table from before the agent existed, so its observation cannot be
   * used as evidence that the agent is gone. The next observation after this one decides.
   */
  ignoreInFlightPoll: boolean;
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
  /**
   * Process group id currently holding the terminal foreground, present only while running.
   *
   * Identifies the foreground job without interpreting what it is. Command lines cannot do that
   * reliably — the same agent appears as `codex` or as `node .../bin/codex` depending on how it was
   * installed — whereas the process group changes exactly when the pane moves to a different job.
   */
  foregroundPgid?: number;
}
