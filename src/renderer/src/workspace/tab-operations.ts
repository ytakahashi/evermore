import { collectPaneIds } from '../../../shared/pane-layout';
import type { Pane, Tab, Workspace } from '../../../shared/types';
import { MAX_WORKSPACE_TABS } from '../../../shared/workspace-constants';
import { getAutomaticTabName, syncTabNameWithPane } from './tab-naming';
import { detachPaneFromTab } from './tab-pane-operations';

/** Validated inputs for {@link extractPaneToTab}, resolved before the caller allocates a tab id. */
export interface PaneExtraction {
  sourceTab: Tab;
  updatedSourceTab: Tab;
  movedPane: Pane;
}

function findTabIndex(workspace: Workspace, tabId: string): number {
  const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
  return index >= 0 ? index : 0;
}

/**
 * Selects the tab at the vacated index, falling back to the previous tab at the end.
 */
export function selectNextTabIdAfterClose(
  workspace: Workspace,
  closingTabId: string,
): string | null {
  const closingIndex = findTabIndex(workspace, closingTabId);
  const remainingTabs = workspace.tabs.filter((tab) => tab.id !== closingTabId);

  return remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]?.id ?? null;
}

/** Removes a tab and its owned panes, returning null for a missing or final tab. */
export function removeTab(workspace: Workspace, tabId: string): Workspace | null {
  const closingTab = workspace.tabs.find((tab) => tab.id === tabId);
  // A workspace must retain at least one tab, including for automatic closes after PTY exit.
  if (!closingTab || workspace.tabs.length <= 1) {
    return null;
  }

  const removedPaneIds = new Set(collectPaneIds(closingTab.layout));
  return {
    ...workspace,
    tabs: workspace.tabs.filter((tab) => tab.id !== tabId),
    panes: workspace.panes.filter((pane) => !removedPaneIds.has(pane.id)),
    activeTabId:
      workspace.activeTabId === tabId
        ? selectNextTabIdAfterClose(workspace, tabId)
        : workspace.activeTabId,
  };
}

/** Reorders a tab with a clamped destination index, returning null when no change is possible. */
export function reorderTab(workspace: Workspace, tabId: string, toIndex: number): Workspace | null {
  const fromIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex === -1) {
    return null;
  }

  // Moving past an edge clamps to that edge; an already-positioned tab is a true no-op.
  const clampedIndex = Math.min(Math.max(toIndex, 0), workspace.tabs.length - 1);
  if (clampedIndex === fromIndex) {
    return null;
  }
  const tabs = [...workspace.tabs];
  const [movedTab] = tabs.splice(fromIndex, 1);
  tabs.splice(clampedIndex, 0, movedTab);
  return { ...workspace, tabs };
}

/**
 * Validates a pane extraction before the caller allocates a destination tab id, so a refused
 * action never consumes an id. Returns null when the tab limit is reached, the tab or pane is
 * missing, or the pane cannot be detached from its tab.
 */
export function preparePaneExtraction(
  workspace: Workspace,
  sourceTabId: string,
  paneId: string,
): PaneExtraction | null {
  if (workspace.tabs.length >= MAX_WORKSPACE_TABS) {
    return null;
  }
  const sourceTab = workspace.tabs.find((tab) => tab.id === sourceTabId);
  const movedPane = workspace.panes.find((pane) => pane.id === paneId);
  if (!sourceTab || !movedPane) {
    return null;
  }
  const result = detachPaneFromTab(sourceTab, paneId);
  return result ? { sourceTab, updatedSourceTab: result.updatedSourceTab, movedPane } : null;
}

/**
 * Detaches a pane into a new active tab whose id is supplied by the caller; returns null when the
 * extraction is refused or `newTabId` already exists in the workspace. Keeps the workspace's pane
 * objects and runtime fields intact so the live terminal survives.
 */
export function extractPaneToTab(
  workspace: Workspace,
  sourceTabId: string,
  paneId: string,
  newTabId: string,
): Workspace | null {
  const extraction = preparePaneExtraction(workspace, sourceTabId, paneId);
  // Explicit ids must still be collision-free; a pure caller cannot silently allocate replacements.
  if (!extraction || workspace.tabs.some((tab) => tab.id === newTabId)) {
    return null;
  }
  const { sourceTab, updatedSourceTab, movedPane } = extraction;
  // Name synchronization is needed only if detachment changed the source's active pane.
  const nextActivePane =
    updatedSourceTab.activePaneId !== sourceTab.activePaneId
      ? workspace.panes.find((pane) => pane.id === updatedSourceTab.activePaneId)
      : undefined;
  const finalSourceTab = nextActivePane
    ? syncTabNameWithPane(updatedSourceTab, nextActivePane)
    : updatedSourceTab;
  const destinationTab: Tab = {
    id: newTabId,
    name: getAutomaticTabName(movedPane.cwd),
    isCustomName: false,
    layout: { type: 'leaf', paneId },
    activePaneId: paneId,
  };
  return {
    ...workspace,
    tabs: [
      ...workspace.tabs.map((tab) => (tab.id === sourceTabId ? finalSourceTab : tab)),
      destinationTab,
    ],
    activeTabId: newTabId,
  };
}
