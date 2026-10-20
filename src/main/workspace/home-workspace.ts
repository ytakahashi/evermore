import type { Workspace } from '../../shared/types';

/**
 * Guarantees that exactly one open `home` workspace exists and that it is rooted at the current
 * home directory.
 *
 * Design decisions:
 *   - Data persisted before `kind` existed carries no home marker. Per-workspace sanitizing turns
 *     every such workspace into an open `project`, and this function then promotes the first one,
 *     so legacy data migrates as "first workspace becomes home, the rest stay open projects". A
 *     store that lost its home through corruption recovers through the same path.
 *   - When several workspaces claim `home`, the first keeps it and the rest are demoted to
 *     `project`, so their layouts survive instead of being dropped.
 *   - Home's `rootPath` follows `homeDirectory` on every load so a changed home directory does not
 *     leave home pointing at a stale path. This also replaces the `rootPath` of a workspace promoted
 *     during migration, which the UI always created at the home directory anyway. Pane cwds are left
 *     alone; they are live shell state.
 *   - Array order is preserved. Pinning home at the top is a display concern.
 *
 * Returns the input array itself when nothing needs to change.
 */
export function ensureSingleHomeWorkspace(
  workspaces: Workspace[],
  homeDirectory: string,
): Workspace[] {
  if (workspaces.length === 0) {
    return workspaces;
  }

  const foundHomeIndex = workspaces.findIndex((workspace) => workspace.kind === 'home');
  // No home (legacy data or corruption): promote the first workspace.
  const homeIndex = foundHomeIndex === -1 ? 0 : foundHomeIndex;
  let changed = false;

  const nextWorkspaces = workspaces.map((workspace, index): Workspace => {
    if (index === homeIndex) {
      if (workspace.kind === 'home' && workspace.isOpen && workspace.rootPath === homeDirectory) {
        return workspace;
      }
      changed = true;
      return { ...workspace, kind: 'home', isOpen: true, rootPath: homeDirectory };
    }

    if (workspace.kind === 'project') {
      return workspace;
    }
    changed = true;
    return { ...workspace, kind: 'project' };
  });

  return changed ? nextWorkspaces : workspaces;
}
