import { getPathBasename } from '../../../shared/path-label';
import type { Pane, Tab } from '../../../shared/types';

const AUTO_TAB_NAME_FALLBACK = 'Tab';

/**
 * Derives the automatic tab name from a pane cwd, falling back for empty or root paths.
 */
export function getAutomaticTabName(cwd: string): string {
  return getPathBasename(cwd, {
    emptyFallback: AUTO_TAB_NAME_FALLBACK,
    rootFallback: AUTO_TAB_NAME_FALLBACK,
  });
}

/**
 * Updates an automatic name from its active pane, preserving custom names.
 */
export function syncTabNameWithPane(tab: Tab, pane: Pane): Tab {
  if (tab.isCustomName) {
    return tab;
  }

  const name = getAutomaticTabName(pane.cwd);
  return tab.name === name ? tab : { ...tab, name };
}

/**
 * Selects a pane and reconciles the tab name without mutating either input.
 */
export function setTabActivePane(tab: Tab, pane: Pane): Tab {
  return syncTabNameWithPane({ ...tab, activePaneId: pane.id }, pane);
}
