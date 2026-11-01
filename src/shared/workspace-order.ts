import type { Workspace } from './types';

/** Which side of an anchor an item should occupy. */
export type DropEdge = 'before' | 'after';

/**
 * Moves a project next to another project in storage order, preserving all other relative order.
 * Returns null for refused moves or unchanged order; never mutates workspace contents or timestamps.
 */
export function moveWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string,
  targetWorkspaceId: string,
  edge: DropEdge,
): Workspace[] | null {
  const source = workspaces.find((workspace) => workspace.id === workspaceId);
  const target = workspaces.find((workspace) => workspace.id === targetWorkspaceId);
  if (!source || !target || source.kind === 'home' || target.kind === 'home' || source === target) {
    return null;
  }

  const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
  const targetIndex = remaining.findIndex((workspace) => workspace.id === targetWorkspaceId);
  remaining.splice(targetIndex + (edge === 'after' ? 1 : 0), 0, source);
  return remaining.every((workspace, index) => workspace === workspaces[index]) ? null : remaining;
}
