import type { Workspace } from './types';

/**
 * Returns whether a workspace may be deleted. The home workspace is permanent, which also
 * guarantees that at least one workspace remains.
 */
export function canDeleteWorkspace(workspace: Workspace): boolean {
  return workspace.kind !== 'home';
}

/**
 * Returns the workspace to activate when no valid active workspace is selected.
 *
 * Home is preferred over array order because pinning home at the top is a display concern: the
 * persisted order may place projects before it. The first workspace is only a last resort for data
 * that has not been normalized by the main-process store.
 */
export function findFallbackWorkspace(workspaces: Workspace[]): Workspace | null {
  return workspaces.find((workspace) => workspace.kind === 'home') ?? workspaces[0] ?? null;
}
