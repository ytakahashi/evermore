import { normalizeAbsolutePath } from '../../../shared/absolute-path';
import { getPathBasename } from '../../../shared/path-label';
import type { Workspace } from '../../../shared/types';

export interface ProjectCandidate {
  rootPath: string;
  name: string;
  status: 'Active' | 'Open' | 'Closed' | null;
}

/** Selects a project deterministically while keeping home distinct from a project rooted at home. */
export function findProjectWorkspace(
  workspaces: Workspace[],
  rootPath: string,
  activeWorkspaceId: string | null,
): Workspace | undefined {
  const key = normalizeAbsolutePath(rootPath);
  const matches = workspaces.filter(
    (workspace) =>
      workspace.kind === 'project' && normalizeAbsolutePath(workspace.rootPath) === key,
  );
  return (
    matches.find((workspace) => workspace.isOpen && workspace.id === activeWorkspaceId) ??
    matches.find((workspace) => workspace.isOpen) ??
    matches[0]
  );
}

/** Combines registered directories and durable projects, preserving registration and storage order. */
export function createProjectCandidates(
  directories: string[],
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): ProjectCandidate[] {
  const paths = new Map<string, string>();
  for (const path of [
    ...directories,
    ...workspaces
      .filter((workspace) => workspace.kind === 'project')
      .map((workspace) => workspace.rootPath),
  ]) {
    const key = normalizeAbsolutePath(path);
    if (!paths.has(key)) paths.set(key, path);
  }
  return [...paths.values()].map((rootPath) => {
    const workspace = findProjectWorkspace(workspaces, rootPath, activeWorkspaceId);
    return {
      rootPath,
      name: workspace?.name ?? getPathBasename(rootPath),
      status: workspace
        ? !workspace.isOpen
          ? 'Closed'
          : workspace.id === activeWorkspaceId
            ? 'Active'
            : 'Open'
        : null,
    };
  });
}

function contiguousScore(text: string, query: string): number | null {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  if (text.includes(query)) return 2;
  return null;
}

function nameScore(name: string, query: string): number | null {
  const text = name.toLocaleLowerCase();
  const contiguous = contiguousScore(text, query);
  if (contiguous !== null) return contiguous;
  let previous = -1;
  let gaps = 0;
  for (const character of query) {
    const index = text.indexOf(character, previous + 1);
    if (index === -1) return null;
    gaps += index - previous - 1;
    previous = index;
  }
  return 3 + gaps / (text.length + 1);
}

/**
 * Ranks candidates stably: contiguous name matches, then fuzzy name matches, then path substrings.
 *
 * Paths only match contiguously. Absolute paths are long and share prefixes such as
 * `/Users/<name>/ghq/github.com`, so a subsequence match would accept nearly every candidate for
 * short queries.
 */
export function filterProjectCandidates(
  entries: ProjectCandidate[],
  query: string,
): ProjectCandidate[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return entries;
  return entries
    .flatMap((entry, index) => {
      const byName = nameScore(entry.name, normalized);
      const byPath = contiguousScore(entry.rootPath.toLocaleLowerCase(), normalized);
      // Fuzzy name scores fall in [3, 4), so path scores are offset past them.
      const score = Math.min(byName ?? Infinity, byPath === null ? Infinity : byPath + 4);
      return Number.isFinite(score) ? [{ entry, index, score }] : [];
    })
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ entry }) => entry);
}
