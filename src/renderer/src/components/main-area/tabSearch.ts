import type { Workspace } from '../../../../shared/types';

export interface TabSearchEntry {
  workspaceId: string;
  workspaceName: string;
  tabId: string;
  tabName: string;
  isActive: boolean;
}

interface ScoredTabSearchEntry {
  entry: TabSearchEntry;
  index: number;
  score: number;
}

/**
 * Flattens loaded workspaces into searchable tab entries while retaining workspace metadata for
 * cross-workspace navigation and result disambiguation.
 */
export function createTabSearchEntries(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): TabSearchEntry[] {
  return workspaces.flatMap((workspace) =>
    workspace.tabs.map((tab) => ({
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      tabId: tab.id,
      tabName: tab.name,
      isActive: workspace.id === activeWorkspaceId && tab.id === workspace.activeTabId,
    })),
  );
}

/**
 * Filters tab entries by tab name only. Matching is intentionally limited to case-insensitive
 * substring search for the first tab-search iteration.
 */
export function filterTabSearchEntries(entries: TabSearchEntry[], query: string): TabSearchEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return entries;
  }

  const scoredEntries: ScoredTabSearchEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    const score = scoreTabName(entry.tabName, normalizedQuery);
    if (score === null) {
      continue;
    }
    scoredEntries.push({ entry, index, score });
  }

  return scoredEntries
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((scoredEntry) => scoredEntry.entry);
}

function scoreTabName(tabName: string, normalizedQuery: string): number | null {
  const normalizedTabName = tabName.toLocaleLowerCase();
  const matchIndex = normalizedTabName.indexOf(normalizedQuery);
  if (matchIndex === -1) {
    return null;
  }

  if (normalizedTabName === normalizedQuery) {
    return 0;
  }

  return normalizedTabName.startsWith(normalizedQuery) ? 1 : 2 + matchIndex / 1000;
}
