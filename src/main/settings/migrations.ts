import { cloneDefaultSettings, DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';

type CursorStyle = AppSettings['terminal']['cursorStyle'];
type QuitConfirm = AppSettings['app']['quitConfirm'];

/**
 * Permitted cursor styles enumerated for migration validation. Kept in sync with `AppSettings`.
 */
const CURSOR_STYLES: readonly CursorStyle[] = ['block', 'bar', 'underline'];
const QUIT_CONFIRM_VALUES: readonly QuitConfirm[] = ['always', 'never', 'running-only'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickCursorStyle(value: unknown, fallback: CursorStyle): CursorStyle {
  return CURSOR_STYLES.includes(value as CursorStyle) ? (value as CursorStyle) : fallback;
}

function pickQuitConfirm(value: unknown, fallback: QuitConfirm): QuitConfirm {
  return QUIT_CONFIRM_VALUES.includes(value as QuitConfirm) ? (value as QuitConfirm) : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function pickStringOrNull(value: unknown, fallback: string | null): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

function pickKeybindings(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [actionId, accelerator] of Object.entries(value)) {
    if (typeof accelerator === 'string' && accelerator.length > 0) {
      result[actionId] = accelerator;
    }
  }
  return result;
}

/**
 * Normalizes any persisted settings payload to the current `AppSettings` shape.
 *
 * The previous shape included `ui.*` (sidebarOpen / sidebarWidth / sidebarView), which has been
 * removed in favor of the renderer's transient `useUiStore`. Any persisted `ui` section is dropped
 * silently here. Unknown fields are also dropped.
 *
 * The function also fills in missing fields with defaults so callers can rely on the result being a
 * fully populated `AppSettings`. For boolean / numeric fields the original value is preserved when
 * present, even when it differs from the new default (for example, `terminal.cursorStyle === 'block'`
 * persists for upgrading users while new installs see the new `'bar'` default).
 */
export function migrateSettings(raw: unknown): AppSettings {
  if (!isPlainObject(raw)) {
    return cloneDefaultSettings();
  }

  const defaults = DEFAULT_APP_SETTINGS;

  const terminalRaw = isPlainObject(raw.terminal) ? raw.terminal : {};
  const paneInfoRaw = isPlainObject(raw.paneInfo) ? raw.paneInfo : {};
  const shortcutsRaw = isPlainObject(raw.shortcuts) ? raw.shortcuts : {};
  const appRaw = isPlainObject(raw.app) ? raw.app : {};

  const terminal: AppSettings['terminal'] = {
    cursorStyle: pickCursorStyle(terminalRaw.cursorStyle, defaults.terminal.cursorStyle),
    cursorBlink: pickBoolean(terminalRaw.cursorBlink, defaults.terminal.cursorBlink),
    macOptionIsMeta: pickBoolean(terminalRaw.macOptionIsMeta, defaults.terminal.macOptionIsMeta),
    copyOnSelect: pickBoolean(terminalRaw.copyOnSelect, defaults.terminal.copyOnSelect),
  };
  if (typeof terminalRaw.fontSize === 'number' && Number.isFinite(terminalRaw.fontSize)) {
    terminal.fontSize = terminalRaw.fontSize;
  }
  if (typeof terminalRaw.fontFamily === 'string' && terminalRaw.fontFamily.length > 0) {
    terminal.fontFamily = terminalRaw.fontFamily;
  }

  return {
    terminal,
    paneInfo: {
      pollIntervalMs: pickPositiveNumber(
        paneInfoRaw.pollIntervalMs,
        defaults.paneInfo.pollIntervalMs,
      ),
    },
    shortcuts: {
      activateAppHotkey: pickStringOrNull(
        shortcutsRaw.activateAppHotkey,
        defaults.shortcuts.activateAppHotkey,
      ),
      keybindings: pickKeybindings(shortcutsRaw.keybindings),
    },
    app: {
      quitConfirm: pickQuitConfirm(appRaw.quitConfirm, defaults.app.quitConfirm),
    },
  };
}

function mergeSection<T extends Record<string, unknown>>(current: T, patch: Partial<T>): T {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

/**
 * Returns a new `AppSettings` object with the supplied partial patch applied.
 *
 * Accepts a section-shaped patch (`{ terminal: { cursorBlink: false } }`) and merges each section
 * field-by-field. `undefined` values are ignored so callers can pass partial section updates
 * without having to spread the existing values themselves.
 */
export function applySettingsPatch(
  current: AppSettings,
  patch: { [K in keyof AppSettings]?: Partial<AppSettings[K]> },
): AppSettings {
  return {
    terminal: patch.terminal
      ? (mergeSection(
          current.terminal as Record<string, unknown>,
          patch.terminal as Record<string, unknown>,
        ) as AppSettings['terminal'])
      : current.terminal,
    paneInfo: patch.paneInfo
      ? (mergeSection(
          current.paneInfo as Record<string, unknown>,
          patch.paneInfo as Record<string, unknown>,
        ) as AppSettings['paneInfo'])
      : current.paneInfo,
    shortcuts: patch.shortcuts
      ? (mergeSection(
          current.shortcuts as Record<string, unknown>,
          patch.shortcuts as Record<string, unknown>,
        ) as AppSettings['shortcuts'])
      : current.shortcuts,
    app: patch.app
      ? (mergeSection(
          current.app as Record<string, unknown>,
          patch.app as Record<string, unknown>,
        ) as AppSettings['app'])
      : current.app,
  };
}
