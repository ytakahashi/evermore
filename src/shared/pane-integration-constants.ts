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

/**
 * Maximum JSON payload size accepted for Evermore OSC 777 agent events.
 *
 * This is separate from the generic OSC buffer limit: the parser may successfully assemble a
 * larger OSC payload, but agent-event JSON is rejected before parsing if it exceeds this size.
 */
export const OSC_777_PAYLOAD_MAX_BYTES = 8192;

/**
 * Character limits applied to `PaneAgentInfo.detail` fields when `PaneInfoTracker` sanitizes an
 * OSC 777 agent event. Bounding these independently of `OSC_777_PAYLOAD_MAX_BYTES` keeps display
 * text short even when the surrounding JSON payload is well within the byte budget.
 */
export const AGENT_DETAIL_MESSAGE_MAX_CHARS = 200;
export const AGENT_DETAIL_ACTIVITY_LABEL_MAX_CHARS = 200;
export const AGENT_DETAIL_TOOL_NAME_MAX_CHARS = 64;
