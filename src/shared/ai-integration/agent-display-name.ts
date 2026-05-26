import type { PaneAgentInfo, PaneKnownAgent } from '../types';

/**
 * Display labels for the closed set of agents the UI maps to dedicated affordances.
 *
 * Kept in `shared/` so the main-process notification path and the renderer Settings / Sidebar can
 * draw from the same source of truth instead of duplicating string literals.
 */
export const AGENT_DISPLAY_NAME: Record<PaneKnownAgent, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  cursor: 'Cursor',
  antigravity: 'Antigravity CLI',
};

/**
 * Fallback label used when no agent or an unrecognised agent is observed. Surfaces in places that
 * need a human-readable string regardless of which agent (if any) the pane is running.
 */
export const UNKNOWN_AGENT_DISPLAY_NAME = 'AI agent';

/**
 * Returns a human-readable label for the agent currently observed in a pane.
 *
 * Falls back to {@link UNKNOWN_AGENT_DISPLAY_NAME} when `agent` is undefined or its `known` value
 * is not in the curated set. Raw `kind` strings are intentionally not surfaced here: the UI text
 * should stay stable across detection noise from unfamiliar agents.
 */
export function formatAgentDisplayName(agent: PaneAgentInfo | undefined): string {
  if (agent?.known && agent.known in AGENT_DISPLAY_NAME) {
    return AGENT_DISPLAY_NAME[agent.known];
  }
  return UNKNOWN_AGENT_DISPLAY_NAME;
}
