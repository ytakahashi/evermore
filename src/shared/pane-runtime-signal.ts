/**
 * Runtime signals extracted from PTY output by the main-process terminal signal parser.
 *
 * Phase 1 only emits these signals. Pane runtime state consumes them in later phases.
 */
export type PaneRuntimeSignal =
  | { type: 'cwd'; cwd: string; source: PaneRuntimeSignalCwdSource }
  | { type: 'shell-prompt-start' }
  | { type: 'shell-prompt-end' }
  | { type: 'shell-command-started' }
  | { type: 'shell-command-finished'; exitCode?: number }
  | { type: 'shell-command-line'; command: string; source: PaneRuntimeSignalCommandSource };

/**
 * Known sources for cwd-bearing terminal runtime signals.
 */
export type PaneRuntimeSignalCwdSource = 'osc7';

/**
 * Known sources for shell command line terminal runtime signals.
 */
export type PaneRuntimeSignalCommandSource = 'osc633';
