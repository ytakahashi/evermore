import {
  collectPaneIds,
  countPaneLeaves,
  findFirstPaneId,
  removePaneLayout,
} from '../../../shared/pane-layout';
import type { Tab } from '../../../shared/types';

export interface DetachPaneResult {
  updatedSourceTab: Tab;
  movedPaneId: string;
}

/**
 * Removes `paneId`'s leaf from `sourceTab.layout` and collapses the vacated split, returning the
 * updated tab and the detached pane id. Returns `null` when `paneId` is not referenced by the
 * layout exactly once, or when the tab has fewer than two panes (a tab must never lose its only
 * pane through this path — that case is surfaced as a disabled action in the UI instead).
 *
 * Deliberately takes no `Workspace.panes`: it only reconciles layout and `activePaneId`. Tab-name
 * sync (which needs the pane's `cwd`) is the caller's responsibility, keeping this helper reusable
 * for a future "move to existing tab" attach primitive that has different naming rules.
 */
export function detachPaneFromTab(sourceTab: Tab, paneId: string): DetachPaneResult | null {
  const paneOccurrences = collectPaneIds(sourceTab.layout).filter((id) => id === paneId).length;
  if (paneOccurrences !== 1 || countPaneLeaves(sourceTab.layout) < 2) {
    return null;
  }

  const removedLayout = removePaneLayout(sourceTab.layout, paneId);
  if (!removedLayout.removed || !removedLayout.layout) {
    return null;
  }

  const remainingPaneIds = collectPaneIds(removedLayout.layout);
  const activePaneId =
    sourceTab.activePaneId !== null && remainingPaneIds.includes(sourceTab.activePaneId)
      ? sourceTab.activePaneId
      : findFirstPaneId(removedLayout.layout);

  return {
    updatedSourceTab: {
      ...sourceTab,
      layout: removedLayout.layout,
      activePaneId,
    },
    movedPaneId: paneId,
  };
}
