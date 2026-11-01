import type { Workspace } from '../../../shared/types';
import type { DropEdge } from '../../../shared/workspace-order';

interface WorkspaceMoveAnchor {
  targetWorkspaceId: string;
  edge: DropEdge;
}

/** Resolves a sidebar drop onto home to the first visible project, since home cannot be an anchor. */
export function resolveWorkspaceDropAnchor(
  sidebarWorkspaces: readonly Workspace[],
  targetWorkspaceId: string,
  edge: DropEdge,
): WorkspaceMoveAnchor | null {
  const target = findOpenWorkspace(sidebarWorkspaces, targetWorkspaceId);
  if (!target) return null;
  if (target.kind === 'project') return { targetWorkspaceId, edge };
  const firstProject = sidebarWorkspaces.find(
    (workspace) => workspace.isOpen && workspace.kind === 'project',
  );
  return firstProject ? { targetWorkspaceId: firstProject.id, edge: 'before' } : null;
}

/** Resolves a menu move to the adjacent visible project, skipping home and closed entries. */
export function resolveWorkspaceMoveAnchor(
  sidebarWorkspaces: readonly Workspace[],
  workspaceId: string,
  direction: 'up' | 'down',
): WorkspaceMoveAnchor | null {
  const projects = sidebarWorkspaces.filter(
    (workspace) => workspace.isOpen && workspace.kind === 'project',
  );
  const index = projects.findIndex((workspace) => workspace.id === workspaceId);
  if (index === -1) return null;
  const target = projects[index + (direction === 'up' ? -1 : 1)];
  return target
    ? { targetWorkspaceId: target.id, edge: direction === 'up' ? 'before' : 'after' }
    : null;
}

/**
 * Returns the workspaces whose terminals are mounted, preserving storage order.
 *
 * Closed workspaces keep their layout and cwd but have no mounted panes, so every navigation surface
 * (sidebar, tab search, move destinations) lists only these. Reopening goes through Open Project or Launch Agent.
 */
export function getOpenWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => workspace.isOpen);
}

/**
 * Finds a workspace that may be activated or receive tabs.
 *
 * A closed workspace is rejected even when the id matches: activating it would show an empty
 * terminal area, and moving a tab into it would unmount the tab's terminals and dispose live PTYs.
 */
export function findOpenWorkspace(
  workspaces: readonly Workspace[],
  id: string | null,
): Workspace | undefined {
  return workspaces.find((workspace) => workspace.id === id && workspace.isOpen);
}

/** Returns open sidebar entries with home pinned first, without changing stored project order. */
export function getSidebarWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  const open = getOpenWorkspaces(workspaces);
  return [
    ...open.filter((workspace) => workspace.kind === 'home'),
    ...open.filter((workspace) => workspace.kind !== 'home'),
  ];
}

/**
 * Returns open Agents view entries with home last, sharing the sidebar's project order.
 *
 * Home is the place for work that belongs to no project, while agents mostly run in projects, so
 * the Agents view leads with projects. Both surfaces derive project order from storage order here;
 * only home's position differs. Project reordering changes storage order so both surfaces follow.
 */
export function getAgentsViewWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  const open = getOpenWorkspaces(workspaces);
  return [
    ...open.filter((workspace) => workspace.kind !== 'home'),
    ...open.filter((workspace) => workspace.kind === 'home'),
  ];
}
