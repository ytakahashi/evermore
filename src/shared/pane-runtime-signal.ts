/**
 * Runtime signals extracted from PTY output by the main-process terminal signal parser.
 *
 * Phase 1 only emits these signals. Pane runtime state consumes them in later phases.
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
  | { type: 'shell-command-line'; command: string; source: PaneRuntimeSignalCommandSource };

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
