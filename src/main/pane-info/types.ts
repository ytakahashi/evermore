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
   * Latest prompt the user submitted, together with the agent it was submitted to.
   *
   * Held as an object rather than the bare string that reaches the renderer because the tracker
   * needs to know *which* agent session the prompt belongs to before it can decide whether the
   * prompt is still current.
   *
   * Retention differs from every other agent-derived field here: a prompt arrives once per turn and
   * is never re-sent, so anything that drops it drops it for the rest of the turn. Signal-driven
   * recomputes therefore never clear this slot — only process-table observations and explicit
   * transitions out of the agent (shell lifecycle, ssh, PTY teardown) do.
   */
  userPrompt?: {
    text: string;
    /**
     * Identity of the agent the prompt was submitted to, compared against the pane's current agent
     * before the prompt is emitted and against each process-table observation before it is dropped.
     *
     * Deliberately not the raw `kind`. The two sources spell the same agent differently — the hook
     * protocol reports `cursor` / `antigravity` while the process table yields the executable
     * basenames `cursor-agent` / `agent` / `agy` — so comparing raw kinds would mark every Cursor
     * and Antigravity session as a mismatch. This holds the normalized form both sides agree on.
     */
    agentIdentity: string;
    /**
     * Foreground process group the prompt was submitted into, once one has been observed.
     *
     * This is what decides whether the agent session is still alive. It is left unset when the
     * process table has not yet caught up to a freshly launched agent, and bound on the first
     * observation that finds the pane running; from then on a different process group means a
     * different job, and the prompt is dropped.
     */
    foregroundPgid?: number;
    /**
     * Set when a process-table poll was already in flight as the prompt arrived. Such a poll may
     * have sampled the process table from before the agent existed, so its observation cannot be
     * used as evidence that the agent is gone. The next observation after this one decides.
     */
    ignoreInFlightPoll: boolean;
  };
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
