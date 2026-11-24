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

/**
 * Display limit applied to `PaneRuntimeInfo.userPrompt` by `PaneInfoTracker`. Matches
 * {@link AGENT_DETAIL_MESSAGE_MAX_CHARS} so prompts and agent messages wrap to comparable lengths
 * in the sidebar and the Agents view.
 */
export const AGENT_USER_PROMPT_MAX_CHARS = 200;

/**
 * Character limit the hook helper script applies to the submitted prompt before it is placed in the
 * OSC 777 payload.
 *
 * Deliberately larger than {@link AGENT_USER_PROMPT_MAX_CHARS}: the visible truncation (the `…`
 * marker) must always come from `sanitizeAgentText()` on the Evermore side. If the shell cut at the
 * display limit the user would see silently shortened text with no indication that anything was
 * dropped.
 *
 * The value also bounds the payload budget. With control characters already removed by the helper,
 * the worst case is 4 UTF-8 bytes per code point. A payload carrying both the prompt and the session
 * title therefore costs at most 500 × 4 + {@link AGENT_SESSION_TITLE_HOOK_MAX_CHARS} × 4 = 2480
 * bytes for those two fields, leaving ample room under {@link OSC_777_PAYLOAD_MAX_BYTES} for `cwd`
 * / `sessionId` / `activityLabel`.
 */
export const AGENT_USER_PROMPT_HOOK_MAX_CHARS = 500;

/**
 * Display limit applied to `PaneRuntimeInfo.sessionTitle` by `PaneInfoTracker`.
 *
 * Agent-generated titles are short (Claude Code `ai-title` values observed so far stay under 60
 * characters), so this mostly bounds titles that come from elsewhere: Codex CLI uses the first
 * message as a provisional title until its own one is generated, and `/rename` accepts free text.
 */
export const AGENT_SESSION_TITLE_MAX_CHARS = 80;

/**
 * Character limit the hook helper script applies to the session title before it is placed in the
 * OSC 777 payload.
 *
 * Larger than {@link AGENT_SESSION_TITLE_MAX_CHARS} for the same reason as
 * {@link AGENT_USER_PROMPT_HOOK_MAX_CHARS}: the visible `…` marker must come from the Evermore side.
 * It also counts toward the payload budget described there.
 */
export const AGENT_SESSION_TITLE_HOOK_MAX_CHARS = 120;
