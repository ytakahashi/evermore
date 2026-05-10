import { homedir } from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import type { SettingsUpdate } from '../../shared/api-types';
import { cloneDefaultSettings, DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';
import type { SettingsStorageAdapter, SettingsStoreOptions } from './types';

/**
 * Returns the settings directory under `~/.config/evermore`. We keep this separate from
 * `~/Library/Application Support/Evermore/` (where workspaces.json lives) so that users can safely
 * hand-edit `settings.json` without risking workspace runtime state, which the app owns and may
 * rewrite on every layout change.
 */
function defaultSettingsDirectory(): string {
  return path.join(homedir(), '.config', 'evermore');
}

class ElectronSettingsStorageAdapter implements SettingsStorageAdapter {
  private readonly store: Store<Record<string, unknown>>;

  public constructor(directory: string = defaultSettingsDirectory()) {
    this.store = new Store<Record<string, unknown>>({
      // electron-store appends `.json` automatically, so the resulting file is
      // <directory>/settings.json. The AppSettings object is stored at the JSON root rather than
      // under a wrapper key so the file stays straightforward for hand-editing.
      name: 'settings',
      cwd: directory,
      defaults: cloneDefaultSettings() as unknown as Record<string, unknown>,
    });
  }

  public getSettings(): unknown {
    return this.store.store;
  }

  public setSettings(settings: AppSettings): void {
    this.store.store = structuredClone(settings) as unknown as Record<string, unknown>;
  }

  public getFilePath(): string {
    return this.store.path;
  }
}

type CursorStyle = AppSettings['terminal']['cursorStyle'];
type QuitConfirm = AppSettings['app']['quitConfirm'];

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

function pickFiniteNumber<T extends number | undefined>(value: unknown, fallback: T): number | T {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
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

function readCurrentSettings(raw: unknown): AppSettings {
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
  const fontSize = pickFiniteNumber(terminalRaw.fontSize, defaults.terminal.fontSize);
  if (fontSize !== undefined) {
    terminal.fontSize = fontSize;
  }
  const fontFamily =
    typeof terminalRaw.fontFamily === 'string' && terminalRaw.fontFamily.length > 0
      ? terminalRaw.fontFamily
      : defaults.terminal.fontFamily;
  if (fontFamily !== undefined) {
    terminal.fontFamily = fontFamily;
  }

  return {
    terminal,
    paneInfo: {
      pollIntervalMs: pickFiniteNumber(
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

function applySettingsPatch(current: AppSettings, patch: SettingsUpdate): AppSettings {
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

/**
 * Persists user preferences and exposes change notifications for runtime reactors.
 *
 * The store keeps an in-memory copy of the current settings shape so reads do not re-parse storage
 * on every IPC call. Writes go through `update()` / `reset()`, which both persist and broadcast to
 * subscribers (e.g. main-side reactors that need to push values into runtime services).
 */
export class SettingsStore {
  private readonly storage: SettingsStorageAdapter;
  private settings: AppSettings;
  private readonly subscribers = new Set<(settings: AppSettings) => void>();

  public constructor(options: SettingsStoreOptions = {}) {
    this.storage = options.storage ?? new ElectronSettingsStorageAdapter();
    this.settings = readCurrentSettings(this.storage.getSettings());
    // Persist normalized values so a hand-edited settings.json with typoed keys gets canonicalized
    // on first launch. Legacy shape migrations are intentionally not supported.
    this.storage.setSettings(this.settings);
  }

  /** Returns the latest in-memory settings snapshot. */
  public get(): AppSettings {
    return this.settings;
  }

  /**
   * Persists a partial update by section and returns the resulting full settings.
   *
   * `undefined` field values inside a section are ignored, mirroring the renderer's debounced
   * patch shape. Sections not present in `patch` are preserved as-is.
   */
  public update(patch: SettingsUpdate): AppSettings {
    const next = readCurrentSettings(applySettingsPatch(this.settings, patch));
    this.settings = next;
    this.storage.setSettings(next);
    this.notify();
    return next;
  }

  /** Replaces persisted settings with built-in defaults and returns them. */
  public reset(): AppSettings {
    const next = cloneDefaultSettings();
    this.settings = next;
    this.storage.setSettings(next);
    this.notify();
    return next;
  }

  /**
   * Re-reads the settings file from disk and refreshes the in-memory cache.
   *
   * This is intended for the "Reload settings from disk" workflow where the user has edited the
   * file directly. It re-reads the current settings shape and normalizes typoed keys.
   */
  public reload(): AppSettings {
    this.settings = readCurrentSettings(this.storage.getSettings());
    this.storage.setSettings(this.settings);
    this.notify();
    return this.settings;
  }

  /** Returns the absolute path to the persisted settings file (for the About section UI). */
  public getFilePath(): string {
    return this.storage.getFilePath();
  }

  /** Subscribes to post-write notifications. Returns an unsubscribe function. */
  public subscribe(listener: (settings: AppSettings) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.subscribers) {
      // Listeners are typically synchronous reactors (paneInfoTracker, hotkeyManager). Catching
      // here keeps a misbehaving reactor from blocking other subscribers.
      try {
        listener(this.settings);
      } catch (error) {
        console.error('SettingsStore subscriber threw', error);
      }
    }
  }
}

export { DEFAULT_APP_SETTINGS };
