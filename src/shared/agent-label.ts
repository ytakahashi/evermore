import { formatAgentDisplayName } from './ai-integration/agent-display-name';
import type { PaneAgentInfo } from './types';

/**
 * Summarizes what a detected agent is currently doing, without naming the agent.
 *
 * Prefers the most specific structured detail available (message, generated activity label, tool
 * name, then the raw hook event name), so the summary reflects the current activity rather than
 * only that an agent is running.
 *
 * Returns `undefined` for a `ready` agent even when detail is present:
 * `PaneInfoTracker.notifyUserInput()` carries the previous `detail` forward when it flips
 * `awaiting-input` back to `ready`, and a `complete` event's `event: "stop"` is not meaningful once
 * the agent is idle again. Surfacing detail only while the agent is actively `running` /
 * `awaiting-input` keeps it in sync with what is actually happening instead of echoing stale
 * activity.
 *
 * Surfaces that show the agent name separately (the Agents view header) use this directly;
 * {@link formatAgentLabel} builds the one-line sidebar form on top of it. Keeping the priority
 * order and the `ready` rule in one place stops the two from drifting.
 */
export function formatAgentActivityDetail(agent: PaneAgentInfo): string | undefined {
  if (agent.status === 'ready') {
    return undefined;
  }

  return (
    agent.detail?.message ??
    agent.detail?.activityLabel ??
    agent.detail?.toolName ??
    agent.detail?.event
  );
}

/**
 * Builds the single-line Sidebar label for a pane with a detected agent, combining the agent's
 * display name with {@link formatAgentActivityDetail}.
 */
export function formatAgentLabel(agent: PaneAgentInfo): string {
  const name = formatAgentDisplayName(agent);
  const detailText = formatAgentActivityDetail(agent);
  return detailText ? `${name} — ${detailText}` : name;
}
