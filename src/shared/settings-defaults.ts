import type { AppSettings } from './types';

/**
 * Default Evermore application settings.
 *
 * Defined in `shared/` so both the main process (electron-store defaults) and the renderer (initial
 * state / "Reset to defaults" UI) can rely on the same source of truth.
 *
 * Notes on chosen defaults:
 *  - `terminal.cursorStyle` is `'bar'`, which intentionally diverges from the previous hard-coded
 *    `'block'`.
 *  - `paneInfo.pollIntervalMs` of 1500 matches `PaneInfoTracker`'s historical default.
 *  - `shortcuts.activateAppHotkey` defaults to `'Command+Shift+,'`. The accelerator is
 *    persisted now; the actual `globalShortcut` registration is wired up later when the Shortcuts
 *    section ships.
 *  - `app.quitConfirm` of `'running-only'` matches the documented intent. The Cmd+Q dialog is
 *    wired up later when the Application section ships.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  terminal: {
    cursorStyle: 'bar',
    cursorBlink: true,
    macOptionIsMeta: true,
    copyOnSelect: true,
    fontSize: 13,
    fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
    fontWeight: 'normal',
    fontWeightBold: 'bold',
  },
  paneInfo: {
    pollIntervalMs: 1500,
  },
  shortcuts: {
    activateAppHotkey: 'Command+Shift+,',
    keybindings: {},
  },
  app: {
    quitConfirm: 'running-only',
  },
};

/**
 * Returns a fresh deep clone of the default settings, suitable for use as a mutable starting point
 * (for example, electron-store `defaults` or a "reset to defaults" action).
 */
export function cloneDefaultSettings(): AppSettings {
  return {
    terminal: { ...DEFAULT_APP_SETTINGS.terminal },
    paneInfo: { ...DEFAULT_APP_SETTINGS.paneInfo },
    shortcuts: {
      ...DEFAULT_APP_SETTINGS.shortcuts,
      keybindings: { ...DEFAULT_APP_SETTINGS.shortcuts.keybindings },
    },
    app: { ...DEFAULT_APP_SETTINGS.app },
  };
}
