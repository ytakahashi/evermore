/**
 * Shell integration stale thresholds used by the main-process pane runtime tracker.
 *
 * These are implementation constants rather than IPC payload fields so threshold changes do not
 * affect renderer compatibility.
 */
export const PANE_INTEGRATION = {
  STALE_AFTER_MISSED_COMMANDS: 2,
  STALE_AFTER_WALL_CLOCK_MS: 60 * 60_000,
} as const;
