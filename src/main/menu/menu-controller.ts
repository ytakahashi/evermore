// macOS-only project: the controller assumes a single application menu and does not branch on
// `process.platform`. See `buildApplicationMenu.ts` for the matching note.
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import type { AppSettings } from '../../shared/types';
import type { SettingsStore } from '../settings/settings-store';
import { buildApplicationMenu, type ShortcutDispatchers } from './buildApplicationMenu';

/**
 * Default debounce window for application-menu rebuilds. Picked to be short enough that the menu
 * bar tracks accelerator edits live in the Settings UI, while still coalescing a stream of
 * keystrokes from the accelerator picker into one rebuild. Exported so tests can inject a smaller
 * value to drive the timer deterministically.
 */
export const MENU_REBUILD_DEBOUNCE_MS = 150;

export interface MenuControllerOptions {
  settingsStore: SettingsStore;
  dispatchers: ShortcutDispatchers;
  getWindow: () => BrowserWindow | null;
  /** Click handler for the Help → Learn More item. Threaded through to `buildApplicationMenu`. */
  openHelp: () => void;
  isDev: boolean;
  /**
   * Sink for the rebuilt menu template. Production wires this to
   * `Menu.setApplicationMenu(Menu.buildFromTemplate(template))`; tests inject a spy and assert on
   * the template structure.
   */
  setApplicationMenu: (template: MenuItemConstructorOptions[]) => void;
  /** Overrides {@link MENU_REBUILD_DEBOUNCE_MS} (tests only). */
  debounceMs?: number;
}

export interface MenuController {
  /** Tears down the settings subscription and clears any pending debounce timer. */
  dispose: () => void;
}

function shallowEqualKeybindings(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Wires the application menu to the persisted keybindings.
 *
 * Performs an initial synchronous build so the menu is present before any window appears, then
 * watches `SettingsStore` for changes. Settings updates that do not touch `shortcuts.keybindings`
 * are ignored to avoid superfluous `Menu.setApplicationMenu` calls on every font / cwd / paneInfo
 * tweak; only meaningful changes go through the debounced rebuild path.
 */
export function createMenuController(options: MenuControllerOptions): MenuController {
  const debounceMs = options.debounceMs ?? MENU_REBUILD_DEBOUNCE_MS;

  const rebuildMenu = (settings: AppSettings): void => {
    const template = buildApplicationMenu({
      keybindings: settings.shortcuts.keybindings,
      dispatchers: options.dispatchers,
      getWindow: options.getWindow,
      openHelp: options.openHelp,
      isDev: options.isDev,
    });
    options.setApplicationMenu(template);
  };

  let previousKeybindings = options.settingsStore.get().shortcuts.keybindings;
  rebuildMenu(options.settingsStore.get());

  let pendingTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingSettings: AppSettings | null = null;
  const flush = (): void => {
    pendingTimer = null;
    if (!pendingSettings) {
      return;
    }
    const next = pendingSettings;
    pendingSettings = null;
    rebuildMenu(next);
  };

  const unsubscribe = options.settingsStore.subscribe((settings) => {
    if (shallowEqualKeybindings(previousKeybindings, settings.shortcuts.keybindings)) {
      return;
    }
    previousKeybindings = settings.shortcuts.keybindings;
    pendingSettings = settings;
    if (pendingTimer !== null) {
      globalThis.clearTimeout(pendingTimer);
    }
    pendingTimer = globalThis.setTimeout(flush, debounceMs);
  });

  return {
    dispose: (): void => {
      unsubscribe();
      if (pendingTimer !== null) {
        globalThis.clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingSettings = null;
    },
  };
}
