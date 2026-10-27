import { normalizeAbsolutePath } from '../../../../shared/absolute-path';
import { formatAgentDisplayName } from '../../../../shared/ai-integration/agent-display-name';
import { flattenLayout } from '../../../../shared/pane-layout';
import { shortenHomePath } from '../../../../shared/path-label';
import type { PaneRuntimeInfo, Workspace, WorkspaceKind } from '../../../../shared/types';
import { getAgentsViewWorkspaces } from '../../workspace/open-workspaces';
import { formatWorkspaceLabels } from '../../workspace/workspace-labels';

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
  workspaceKind: WorkspaceKind;
  workspaceRootPath: string;
  tabId: string;
  tabName: string;
  /** Runtime snapshot, which may be absent for a retained selected pane. */
  info: PaneRuntimeInfo | undefined;
  /** Working directory as recorded on the pane, used for the card footer. */
  cwd: string;
}

/** Consecutive sessions of one workspace, rendered under a single section heading. */
export interface AgentSessionGroup {
  workspaceId: string;
  workspaceName: string;
  workspaceRootPath: string;
  sessions: AgentSession[];
}

/**
 * Collects every pane running an agent, in Agents view order: projects as the Workspaces sidebar
 * lists them, then home.
 *
 * Kept as a plain function rather than inlined into the view so the selection and ordering rules
 * are testable without React.
 *
 * The order is purely structural — workspace, then tab, then pane position. Sorting by status or by
 * last update was considered and rejected: agent state changes every few seconds, so either would
 * make cards jump around while the user is reading them, and status is already carried by the
 * badge. Structural order also lines project cards up with the sidebar, so moving between the two
 * surfaces preserves the reader's sense of place. Home is the one exception: the sidebar pins it
 * first, but here it comes last because agents mostly run in projects (see
 * `getAgentsViewWorkspaces`).
 *
 * The returned flat order is also the visual order and the arrow-key order: grouping derives from
 * it through `groupAgentSessions` rather than reordering anything.
 *
 * Selection validity depends on the pane and PTY, never on a transient runtime snapshot.
 * Nothing here is cached by id: the whole list is rebuilt from the current workspaces and runtime
 * snapshots on every render, so a closed pane or a deleted workspace simply stops appearing.
 */
export function collectAgentSessions(
  workspaces: readonly Workspace[],
  infosByPtyId: Readonly<Record<string, PaneRuntimeInfo>>,
  options: { retainPaneId?: string; retainPaneIds?: readonly string[] } = {},
): AgentSession[] {
  const sessions: AgentSession[] = [];
  const workspaceLabels = formatWorkspaceLabels(workspaces);

  for (const workspace of getAgentsViewWorkspaces(workspaces)) {
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
        if (
          !info?.agent &&
          pane.id !== options.retainPaneId &&
          !options.retainPaneIds?.includes(pane.id)
        ) {
          continue;
        }

        sessions.push({
          paneId: pane.id,
          ptyId: pane.ptyId,
          workspaceId: workspace.id,
          workspaceName: workspaceLabels.get(workspace.id) ?? workspace.name,
          workspaceKind: workspace.kind,
          workspaceRootPath: workspace.rootPath,
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

/**
 * Groups consecutive sessions by workspace. `collectAgentSessions` emits each workspace's sessions
 * contiguously, so the groups preserve the flat order that arrow keys follow, and a workspace
 * without sessions produces no group.
 */
export function groupAgentSessions(sessions: readonly AgentSession[]): AgentSessionGroup[] {
  const groups: AgentSessionGroup[] = [];
  for (const session of sessions) {
    const last = groups.at(-1);
    if (last?.workspaceId === session.workspaceId) {
      last.sessions.push(session);
      continue;
    }
    groups.push({
      workspaceId: session.workspaceId,
      workspaceName: session.workspaceName,
      workspaceRootPath: session.workspaceRootPath,
      sessions: [session],
    });
  }
  return groups;
}

/**
 * Formats a card's working directory relative to where its workspace heading already points.
 *
 * - Project root: `null`, since the heading shows the root.
 * - Inside the project: the path relative to the root.
 * - Outside the project, or anywhere in home: the absolute path with `~` shortening. Home's own
 *   root renders as `~` rather than `null` so it reads as a location, not a missing one.
 */
export function formatAgentCwdLabel(
  cwd: string,
  workspaceKind: WorkspaceKind,
  rootPath: string,
  homeDirectory: string | undefined,
): string | null {
  // `normalizeAbsolutePath` would silently re-root a relative path at `/`. An empty cwd has no
  // location to show, so it hides the line just like the project root does; pane cwds are recorded
  // as absolute paths, so this is only a guard.
  if (!cwd.startsWith('/')) return cwd || null;
  const normalizedCwd = normalizeAbsolutePath(cwd);

  if (workspaceKind === 'project' && rootPath.startsWith('/')) {
    // Same normalization as project root matching, so segment boundaries decide containment.
    const root = normalizeAbsolutePath(rootPath);
    if (normalizedCwd === root) return null;
    const prefix = root === '/' ? '/' : `${root}/`;
    if (normalizedCwd.startsWith(prefix)) return normalizedCwd.slice(prefix.length);
  }

  return shortenHomePath(normalizedCwd, homeDirectory);
}

/** Distinguishes an ended agent from temporarily unavailable runtime information. */
export function getAgentSessionName(session: AgentSession): string {
  if (!session.info) return 'Agent status unavailable';
  if (!session.info.agent) return 'No agent running';
  return formatAgentDisplayName(session.info.agent);
}
