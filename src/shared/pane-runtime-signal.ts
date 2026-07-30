/**
 * Runtime signals extracted from PTY output by the main-process terminal signal parser and
 * consumed by `PaneInfoTracker` to drive shell-integration-aware pane runtime state.
 */
export type PaneRuntimeSignal =
  | { type: 'cwd'; cwd: string; source: PaneRuntimeSignalCwdSource }
  | { type: 'shell-prompt-start'; source: PaneRuntimeSignalLifecycleSource }
  | { type: 'shell-prompt-end'; source: PaneRuntimeSignalLifecycleSource }
  | { type: 'shell-command-started'; source: PaneRuntimeSignalLifecycleSource }
  | {
      type: 'shell-command-finished';
      source: PaneRuntimeSignalLifecycleSource;
      exitCode?: number;
    }
  | { type: 'shell-command-line'; command: string; source: PaneRuntimeSignalCommandSource }
  | { type: 'agent-event'; source: 'evermore-osc777'; event: EvermoreAgentEvent };

/**
 * Versioned JSON payload emitted by Evermore-aware AI agent hooks through OSC 777.
 *
 * The external protocol accepts `complete` because hook authors naturally describe turn
 * completion that way. `PaneInfoTracker` normalizes it to internal `agent.status === 'ready'`.
 */
export interface EvermoreAgentEvent {
  v: 1;
  type: 'agent-status';
  agent: string;
  status: 'running' | 'awaiting-input' | 'complete';
  message?: string;
  event?: string;
  sessionId?: string;
  cwd?: string;
  toolName?: string;
  /** Sidebar-only, machine-generated activity summary (for example `Edit: src/App.tsx`). */
  activityLabel?: string;
  /**
   * Body of the prompt the user just submitted. Only prompt-submitting hook events carry this: the
   * helper script refuses to read a `prompt`-shaped key from any other event so agent-authored text
   * (subagent instructions, tool arguments) can never be presented as something the user typed.
   */
  userPrompt?: string;
  toolInput?: unknown;
}

/**
 * `EvermoreAgentEvent.event` value the hook snippets use for prompt submission.
 *
 * Shared between the helper script (which only extracts a prompt for this event) and
 * `PaneInfoTracker` (which only accepts one for this event), so the two ends of the restriction
 * cannot drift apart.
 */
export const AGENT_USER_PROMPT_SUBMIT_EVENT = 'user_prompt_submit';

/**
 * Known sources for cwd-bearing terminal runtime signals.
 */
export type PaneRuntimeSignalCwdSource = 'osc7';

/**
 * Known sources for shell lifecycle terminal runtime signals.
 */
export type PaneRuntimeSignalLifecycleSource = 'osc133' | 'osc633';

/**
 * Known sources for shell command line terminal runtime signals.
 */
export type PaneRuntimeSignalCommandSource = 'osc633';
