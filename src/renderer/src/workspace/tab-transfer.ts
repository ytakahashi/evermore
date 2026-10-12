import { collectPaneIds, remapPaneLayoutIds } from '../../../shared/pane-layout';
import type { Tab, Workspace } from '../../../shared/types';
import { selectNextTabIdAfterClose } from './tab-operations';

/** Validated inputs for {@link transferTab}, resolved before the caller allocates ids. */
export interface TabTransfer {
  tabId: string;
  paneIds: string[];
}

export interface TransferTabOptions {
  movedTabId: string;
  paneIdByOldId: ReadonlyMap<string, string>;
  toIndex?: number;
}

/**
 * Validates a transfer before the caller allocates ids, so a refused action never consumes one, and
 * lists the moving tab's owned pane ids in layout order.
 */
export function prepareTabTransfer(
  source: Workspace,
  target: Workspace,
  tabId: string,
): TabTransfer | null {
  // Moving within a workspace is a reorder; moving the final tab would leave the source empty.
  if (source.id === target.id || source.tabs.length <= 1) {
    return null;
  }
  const tab = source.tabs.find((current) => current.id === tabId);
  return tab ? { tabId, paneIds: [...new Set(collectPaneIds(tab.layout))] } : null;
}

/**
 * Moves a tab and its owned panes using explicit ids, returning both workspace snapshots together.
 * Leaves timestamps, global workspace focus, id generation, and persistence to the caller.
 */
export function transferTab(
  source: Workspace,
  target: Workspace,
  tabId: string,
  options: TransferTabOptions,
): { source: Workspace; target: Workspace } | null {
  const transfer = prepareTabTransfer(source, target, tabId);
  const movingTab = source.tabs.find((tab) => tab.id === tabId);
  if (!transfer || !movingTab) {
    return null;
  }

  const { movedTabId, paneIdByOldId, toIndex } = options;
  // Explicit ids must still be collision-free; a pure caller cannot silently allocate replacements.
  if (target.tabs.some((tab) => tab.id === movedTabId)) {
    return null;
  }
  const usedPaneIds = new Set(target.panes.map((pane) => pane.id));
  for (const paneId of transfer.paneIds) {
    const nextPaneId = paneIdByOldId.get(paneId) ?? paneId;
    if (usedPaneIds.has(nextPaneId)) {
      return null;
    }
    usedPaneIds.add(nextPaneId);
  }
  const movingPaneIds = new Set(transfer.paneIds);
  const movedTab: Tab = {
    ...movingTab,
    id: movedTabId,
    layout: remapPaneLayoutIds(movingTab.layout, paneIdByOldId),
    activePaneId: movingTab.activePaneId
      ? (paneIdByOldId.get(movingTab.activePaneId) ?? movingTab.activePaneId)
      : movingTab.activePaneId,
  };
  const movingPanes = source.panes
    .filter((pane) => movingPaneIds.has(pane.id))
    .map((pane) => ({
      // Runtime fields travel with the pane; dropping ptyId would desynchronize the live terminal.
      ...pane,
      id: paneIdByOldId.get(pane.id) ?? pane.id,
    }));
  const updatedSource: Workspace = {
    ...source,
    tabs: source.tabs.filter((tab) => tab.id !== tabId),
    panes: source.panes.filter((pane) => !movingPaneIds.has(pane.id)),
    activeTabId:
      source.activeTabId === tabId ? selectNextTabIdAfterClose(source, tabId) : source.activeTabId,
  };
  // Inclusive upper bound permits appending; an omitted index preserves menu-driven behavior.
  const insertAt =
    toIndex === undefined ? target.tabs.length : Math.min(Math.max(toIndex, 0), target.tabs.length);
  const tabs = [...target.tabs];
  tabs.splice(insertAt, 0, movedTab);
  return {
    source: updatedSource,
    target: {
      ...target,
      tabs,
      panes: [...target.panes, ...movingPanes],
      // The moved tab is selected in its destination even when global focus stays elsewhere.
      activeTabId: movedTab.id,
    },
  };
}
