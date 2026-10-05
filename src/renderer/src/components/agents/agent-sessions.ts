import { formatAgentDisplayName } from '../../../../shared/ai-integration/agent-display-name';
import { flattenLayout } from '../../../../shared/pane-layout';
import type { PaneRuntimeInfo, Workspace } from '../../../../shared/types';

/**
 * One agent pane, or a selected live pane retained while agent information is unavailable,
 * resolved to everything the Agents view needs to render a card and act on a click.
 */
export interface AgentSession {
  /** Stable React key. Pane ids are globally unique across workspaces, so the pane id suffices. */
  paneId: string;
  ptyId: string;
  workspaceId: string;
  workspaceName: string;
  tabId: string;
  tabName: string;
  /** Runtime snapshot, which may be absent for a retained selected pane. */
  info: PaneRuntimeInfo | undefined;
  /** Working directory as recorded on the pane, used for the card footer. */
  cwd: string;
}

/**
 * Collects every pane running an agent, in the order the Workspaces sidebar lists them.
 *
 * Kept as a plain function rather than inlined into the view so the selection and ordering rules
 * are testable without React.
 *
 * The order is purely structural — workspace, then tab, then pane position. Sorting by status or by
 * last update was considered and rejected: agent state changes every few seconds, so either would
 * make cards jump around while the user is reading them, and status is already carried by the
 * badge. Structural order also lines the cards up with the sidebar, so moving between the two
 * surfaces preserves the reader's sense of place.
 *
 * Selection validity depends on the pane and PTY, never on a transient runtime snapshot.
 * Nothing here is cached by id: the whole list is rebuilt from the current workspaces and runtime
 * snapshots on every render, so a closed pane or a deleted workspace simply stops appearing.
 */
export function collectAgentSessions(
  workspaces: readonly Workspace[],
  infosByPtyId: Readonly<Record<string, PaneRuntimeInfo>>,
  options: { retainPaneId?: string } = {},
): AgentSession[] {
  const sessions: AgentSession[] = [];

  for (const workspace of workspaces) {
    const panesById = new Map(workspace.panes.map((pane) => [pane.id, pane]));

    for (const tab of workspace.tabs) {
      for (const { paneId } of flattenLayout(tab.layout).panes) {
        // A layout can reference a pane the `panes` array no longer holds while a structural edit
        // is mid-flight; skipping keeps the view rendering instead of throwing on a transient gap.
        const pane = panesById.get(paneId);
        // No ptyId means the pane has not started a shell yet, so there is no runtime info to read
        // and by definition no agent to show.
        if (!pane?.ptyId) {
          continue;
        }

        const info = infosByPtyId[pane.ptyId];
        if (!info?.agent && pane.id !== options.retainPaneId) {
          continue;
        }

        sessions.push({
          paneId: pane.id,
          ptyId: pane.ptyId,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          tabId: tab.id,
          tabName: tab.name,
          info,
          cwd: pane.cwd,
        });
      }
    }
  }

  return sessions;
}

/** Distinguishes an ended agent from temporarily unavailable runtime information. */
export function getAgentSessionName(session: AgentSession): string {
  if (!session.info) return 'Agent status unavailable';
  if (!session.info.agent) return 'No agent running';
  return formatAgentDisplayName(session.info.agent);
}
