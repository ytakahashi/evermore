import { PANE_INTEGRATION } from '../../shared/pane-integration-constants';
import type { PaneIntegrationInfo } from '../../shared/types';

/**
 * Returns whether a previously observed shell integration has likely stopped emitting lifecycle
 * signals and fallback process-table/input heuristics should become primary again.
 */
export function isIntegrationStale(
  integration: PaneIntegrationInfo,
  missedPsCommandStarts: number,
  now: number,
): boolean {
  if (!integration.shell) {
    return false;
  }

  if (missedPsCommandStarts >= PANE_INTEGRATION.STALE_AFTER_MISSED_COMMANDS) {
    return true;
  }

  return (
    now - integration.lastSequenceAt > PANE_INTEGRATION.STALE_AFTER_WALL_CLOCK_MS &&
    missedPsCommandStarts > 0
  );
}
