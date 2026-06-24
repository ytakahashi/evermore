/**
 * One entry in a `ContextMenu`. `action` items are clickable commands; `separator` and `label` are
 * non-interactive structure so callers can group commands (e.g. a "Move to workspace" heading
 * followed by one action per target workspace) without a nested fly-out submenu.
 *
 * Kept in this non-component module so helpers like {@link hasActionableItem} can be shared with the
 * components that build menus without tripping `react-refresh/only-export-components`.
 */
export type ContextMenuItem =
  | { type: 'action'; id: string; label: string; disabled?: boolean; onSelect: () => void }
  | { type: 'separator' }
  | { type: 'label'; label: string };

/** Narrows to an action item the user can actually invoke (an action that is not disabled). */
export function isSelectableItem(
  item: ContextMenuItem,
): item is Extract<ContextMenuItem, { type: 'action' }> {
  return item.type === 'action' && !item.disabled;
}

/**
 * Returns true when at least one item is an enabled action, i.e. the menu offers something the user
 * can actually invoke. Callers use this to avoid opening an all-disabled "dead" menu (e.g. the move
 * commands for a lone tab, which are all disabled).
 */
export function hasActionableItem(items: ContextMenuItem[]): boolean {
  return items.some(isSelectableItem);
}
