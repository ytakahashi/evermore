import { formatAgentDisplayName } from './ai-integration/agent-display-name';
import type { PaneAgentInfo } from './types';

/**
 * Builds the Sidebar label for a pane with a detected agent.
 *
 * Prefers the most specific structured detail available (message, generated activity label, tool
 * name, then the raw hook event name) over the agent's display name alone, so the label reflects
 * what the agent is currently doing rather than only that an agent is running.
 *
 * `ready` intentionally omits detail: `PaneInfoTracker.notifyUserInput()` carries the previous
 * `detail` forward when it flips `awaiting-input` back to `ready`, and a `complete` event's
 * `event: "stop"` is not meaningful once the agent is idle again. Showing detail only while the
 * agent is actively `running`/`awaiting-input` keeps the label in sync with what is actually
 * happening instead of echoing stale activity.
 */
export function formatAgentLabel(agent: PaneAgentInfo): string {
  const name = formatAgentDisplayName(agent);
  if (agent.status === 'ready') {
    return name;
  }

  const detailText =
    agent.detail?.message ??
    agent.detail?.activityLabel ??
    agent.detail?.toolName ??
    agent.detail?.event;
  return detailText ? `${name} — ${detailText}` : name;
}
