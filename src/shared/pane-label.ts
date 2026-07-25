import { formatAgentLabel } from './agent-label';
import { getPathBasename } from './path-label';
import type { PaneRuntimeInfo } from './types';

/**
 * Returns the primary display label for a pane.
 *
 * A detected agent takes precedence over the shell-derived `foregroundCommand`: while an agent's
 * TUI is in the foreground, `foregroundCommand` reflects whichever subprocess the agent happens to
 * be running at each process-table poll (a tool invocation, a git call, ...), which flickers on
 * every poll once shell-integration staleness falls back to it. `PaneInfoTracker.computeAgent()`
 * only ever sets `agent` while `processActivity === 'running'`, so checking `info?.agent` alone is
 * sufficient without an extra `processActivity` guard.
 *
 * Otherwise, runtime activity takes precedence so callers surface the active foreground command
 * while a pane is busy. Idle panes fall back to the basename of their cwd, matching the sidebar's
 * historical behavior.
 */
export function getPaneDisplayLabel(info: PaneRuntimeInfo | undefined, cwd: string): string {
  if (info?.agent) {
    return formatAgentLabel(info.agent);
  }

  if (info?.processActivity === 'running' && info.foregroundCommand) {
    return info.foregroundCommand;
  }

  return getPathBasename(cwd, { emptyFallback: '(loading)' });
}
