// macOS-only project: this template uses macOS conventions (App menu, role-based standard
// items, `Command` accelerators) and does not branch on `process.platform`. Cross-platform support
// would belong behind a platform adapter rather than scattered conditionals here.
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import {
  ACTION_LABELS,
  DEFAULT_KEYBINDINGS,
  ROLE_ACCELERATORS,
  type KeyboardShortcutActionId,
} from '../../shared/keyboard-shortcuts';

export type ShortcutDispatchers = Record<KeyboardShortcutActionId, () => void>;

export interface BuildApplicationMenuOptions {
  /**
   * Resolved keybindings map (defaults overlaid with user overrides). Action ids missing from this
   * map fall back to the {@link DEFAULT_KEYBINDINGS} accelerator; an empty-string entry means the
   * user explicitly unbound the action — the menu item is still rendered but without an
   * accelerator, so it remains discoverable via the menu bar.
   */
  keybindings: Record<string, string>;
  /** Click handler per action id; usually returned by `createShortcutDispatcher`. */
  dispatchers: ShortcutDispatchers;
  /** Window resolver injected so `Close Window` can target the focused window without globals. */
  getWindow: () => BrowserWindow | null;
  /**
   * Click handler for the Help → Learn More item. Injected so the menu builder stays pure (mirrors
   * the `getWindow` injection for `Close Window`). Production wires this to `shell.openExternal`.
   */
  openHelp: () => void;
  /** Adds the DevTools toggle entry under View when true. */
  isDev: boolean;
}

/**
 * Resolves the accelerator for an Evermore action. Returns `undefined` for explicit unbinds (`""`)
 * so the menu item renders without a key combination but still dispatches via click.
 */
function resolveAccelerator(
  actionId: KeyboardShortcutActionId,
  keybindings: Record<string, string>,
): string | undefined {
  const value = keybindings[actionId] ?? DEFAULT_KEYBINDINGS[actionId];
  return value.length > 0 ? value : undefined;
}

function actionItem(
  actionId: KeyboardShortcutActionId,
  options: BuildApplicationMenuOptions,
): MenuItemConstructorOptions {
  return {
    label: ACTION_LABELS[actionId],
    accelerator: resolveAccelerator(actionId, options.keybindings),
    click: (): void => {
      options.dispatchers[actionId]();
    },
  };
}

/**
 * Builds the macOS application-menu template for Evermore.
 *
 * Returned as a plain `MenuItemConstructorOptions[]` so tests can assert against the template
 * without standing up a real `Menu` instance. The runtime caller (`menu-controller`) is the only
 * place that should pass this through `Menu.buildFromTemplate(...)` and
 * `Menu.setApplicationMenu(...)`.
 *
 * Notes on specific items:
 *  - `Close Window` is intentionally a custom item (label + click handler) rather than
 *    `role: 'close'`. Electron's `close` role registers its own built-in `Cmd+W` binding, which
 *    would clash with the File menu's `Close Tab` reservation. Routing through `getWindow()`
 *    keeps `buildApplicationMenu` pure so tests can swap in a fake window resolver.
 *  - DevTools toggle is gated on `isDev` to mirror `attachWindowShortcuts`' production
 *    suppression of `Cmd+Option+I`.
 */
export function buildApplicationMenu(
  options: BuildApplicationMenuOptions,
): MenuItemConstructorOptions[] {
  const appMenu: MenuItemConstructorOptions = {
    label: 'Evermore',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      actionItem('ui.openSettings', options),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', accelerator: ROLE_ACCELERATORS.hide },
      { role: 'hideOthers', accelerator: ROLE_ACCELERATORS.hideOthers },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit', accelerator: ROLE_ACCELERATORS.quit },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      actionItem('workspace.newTab', options),
      actionItem('workspace.closeTab', options),
      { type: 'separator' },
      actionItem('workspace.nextTab', options),
      actionItem('workspace.previousTab', options),
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo', accelerator: ROLE_ACCELERATORS.undo },
      { role: 'redo', accelerator: ROLE_ACCELERATORS.redo },
      { type: 'separator' },
      { role: 'cut', accelerator: ROLE_ACCELERATORS.cut },
      { role: 'copy', accelerator: ROLE_ACCELERATORS.copy },
      { role: 'paste', accelerator: ROLE_ACCELERATORS.paste },
      { role: 'selectAll', accelerator: ROLE_ACCELERATORS.selectAll },
    ],
  };

  const viewSubmenu: MenuItemConstructorOptions[] = [
    actionItem('pane.splitVertical', options),
    actionItem('pane.splitHorizontal', options),
    { type: 'separator' },
    actionItem('pane.focusLeft', options),
    actionItem('pane.focusRight', options),
    actionItem('pane.focusUp', options),
    actionItem('pane.focusDown', options),
    { type: 'separator' },
    actionItem('pane.toggleFullscreen', options),
    { type: 'separator' },
    actionItem('ui.toggleSidebar', options),
    { type: 'separator' },
    // Override the localized "Enter/Exit Full Screen" label so the window-level toggle is
    // unambiguously labeled relative to `pane.toggleFullscreen` above. macOS still injects its
    // own native "Full Screen" item alongside this one, but the explicit "Window" label keeps the
    // pair readable. Overriding `label` freezes the toggle text — accepted tradeoff for clarity.
    {
      role: 'togglefullscreen',
      label: 'Toggle Window Full Screen',
      accelerator: ROLE_ACCELERATORS.togglefullscreen,
    },
  ];
  if (options.isDev) {
    viewSubmenu.push(
      { type: 'separator' },
      { role: 'toggleDevTools', accelerator: ROLE_ACCELERATORS.toggleDevTools },
    );
  }
  const viewMenu: MenuItemConstructorOptions = { label: 'View', submenu: viewSubmenu };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', accelerator: ROLE_ACCELERATORS.minimize },
      {
        label: 'Close Window',
        // Intentionally no `accelerator`: `Cmd+W` is reserved for `workspace.closeTab` in File.
        click: (): void => {
          options.getWindow()?.close();
        },
      },
    ],
  };

  // macOS exposes the Help menu's auto-search affordance via `role: 'help'`. The injected
  // `openHelp` callback wires the "Learn More" item to whichever side-effect production needs
  // (typically `shell.openExternal`), keeping `buildApplicationMenu` pure for tests.
  const helpMenu: MenuItemConstructorOptions = {
    label: 'Help',
    role: 'help',
    submenu: [
      {
        label: 'Learn More',
        click: (): void => {
          options.openHelp();
        },
      },
    ],
  };

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
}
