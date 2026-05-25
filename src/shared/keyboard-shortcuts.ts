/**
 * Single source of truth for Evermore's keyboard shortcut action ids, their default accelerators,
 * and the labels surfaced in Settings UI and the menu bar.
 *
 * The macOS application menu owns accelerator resolution: the main process renders this map into
 * `Menu.setApplicationMenu(...)` and dispatches the matched action over IPC, so the renderer never
 * installs its own keydown hook for these shortcuts. macOS-only project: accelerators use
 * `Command` / `Option` / `Control` / `Shift` and never `CommandOrControl`.
 */

export type KeyboardShortcutActionId =
  | 'workspace.newTab'
  | 'workspace.closeTab'
  | 'workspace.nextTab'
  | 'workspace.previousTab'
  | 'pane.splitVertical'
  | 'pane.splitHorizontal'
  | 'pane.focusLeft'
  | 'pane.focusRight'
  | 'pane.focusUp'
  | 'pane.focusDown'
  | 'ui.toggleSidebar'
  | 'ui.openSettings';

export const KEYBOARD_SHORTCUT_ACTION_IDS: readonly KeyboardShortcutActionId[] = [
  'workspace.newTab',
  'workspace.closeTab',
  'workspace.nextTab',
  'workspace.previousTab',
  'pane.splitVertical',
  'pane.splitHorizontal',
  'pane.focusLeft',
  'pane.focusRight',
  'pane.focusUp',
  'pane.focusDown',
  'ui.toggleSidebar',
  'ui.openSettings',
] as const;

export const KEYBOARD_SHORTCUT_ACTION_ID_SET: ReadonlySet<KeyboardShortcutActionId> = new Set(
  KEYBOARD_SHORTCUT_ACTION_IDS,
);

export function isKeyboardShortcutActionId(value: unknown): value is KeyboardShortcutActionId {
  return (
    typeof value === 'string' &&
    KEYBOARD_SHORTCUT_ACTION_ID_SET.has(value as KeyboardShortcutActionId)
  );
}

/**
 * Default accelerator per action id. Stored as Electron Accelerator strings so the same value can
 * flow into a `MenuItemConstructorOptions.accelerator` field unchanged.
 */
export const DEFAULT_KEYBINDINGS: Record<KeyboardShortcutActionId, string> = {
  'workspace.newTab': 'Command+T',
  'workspace.closeTab': 'Command+W',
  'workspace.nextTab': 'Command+]',
  'workspace.previousTab': 'Command+[',
  'pane.splitVertical': 'Command+D',
  'pane.splitHorizontal': 'Command+Shift+D',
  'pane.focusLeft': 'Command+Option+Left',
  'pane.focusRight': 'Command+Option+Right',
  'pane.focusUp': 'Command+Option+Up',
  'pane.focusDown': 'Command+Option+Down',
  'ui.toggleSidebar': 'Command+B',
  'ui.openSettings': 'Command+,',
};

export const ACTION_LABELS: Record<KeyboardShortcutActionId, string> = {
  'workspace.newTab': 'New Tab',
  'workspace.closeTab': 'Close Tab',
  'workspace.nextTab': 'Next Tab',
  'workspace.previousTab': 'Previous Tab',
  'pane.splitVertical': 'Split Vertically',
  'pane.splitHorizontal': 'Split Horizontally',
  'pane.focusLeft': 'Focus Left Pane',
  'pane.focusRight': 'Focus Right Pane',
  'pane.focusUp': 'Focus Upper Pane',
  'pane.focusDown': 'Focus Lower Pane',
  'ui.toggleSidebar': 'Toggle Sidebar',
  'ui.openSettings': 'Preferences…',
};

/**
 * Structural subset of Electron's `MenuItemConstructorOptions` used by `getReservedAccelerators`.
 *
 * Defined here in `shared/` so both Settings UI (renderer) and `buildApplicationMenu` tests (main)
 * can derive the reserved accelerator set from the same template object. Kept as a structural type
 * to avoid taking an `electron` dependency from `shared/`.
 */
export interface MenuTemplateNode {
  accelerator?: string;
  submenu?: readonly MenuTemplateNode[];
}

/**
 * Collects every `accelerator` string from a menu template, walking into `submenu` recursively.
 *
 * Used to surface accelerator conflict warnings in Settings UI: any accelerator the application
 * menu has already reserved (Evermore actions plus standard role items such as `Cmd+C` / `Cmd+V` /
 * `Cmd+Q`) is reported as a conflict source, keeping the warning set in sync with the menu
 * structure rather than a hardcoded list.
 */
export function getReservedAccelerators(template: readonly MenuTemplateNode[]): Set<string> {
  const result = new Set<string>();
  const visit = (nodes: readonly MenuTemplateNode[]): void => {
    for (const node of nodes) {
      if (typeof node.accelerator === 'string' && node.accelerator.length > 0) {
        result.add(node.accelerator);
      }
      if (node.submenu) {
        visit(node.submenu);
      }
    }
  };
  visit(template);
  return result;
}
