import { getPathBasename } from './path-label';
import type { PaneRuntimeInfo } from './types';

/**
 * Returns the primary display label for a pane.
 *
 * Runtime activity takes precedence so callers surface the active foreground command while a pane
 * is busy. Idle panes fall back to the basename of their cwd, matching the sidebar's historical
 * behavior.
 */
export function getPaneDisplayLabel(info: PaneRuntimeInfo | undefined, cwd: string): string {
  if (info?.processActivity === 'running' && info.foregroundCommand) {
    return info.foregroundCommand;
  }

  return getPathBasename(cwd, { emptyFallback: '(loading)' });
}
