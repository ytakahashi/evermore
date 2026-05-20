import { homedir } from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import type { SettingsUpdate } from '../../shared/api-types';
import { cloneDefaultSettings, DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings, FontWeight } from '../../shared/types';
import type { PersistedSettings, SettingsStorageAdapter, SettingsStoreOptions } from './types';

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
      //
      // We deliberately do NOT pass a `defaults` option: defaults belong to the runtime layer
      // (see `readCurrentSettings` and `DEFAULT_APP_SETTINGS`). Persisting defaults would force
      // every fresh install to materialize the full settings tree on disk, masking which fields
      // the user actually changed and freezing today's defaults into each user's file.
      name: 'settings',
      cwd: directory,
    });
  }

  public getSettings(): unknown {
    return this.store.store;
  }

  public setSettings(settings: PersistedSettings): void {
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
    // Empty string is a valid value: it means "the user explicitly unbound this action" so the
    // default binding for that id should not apply. Non-string entries (e.g. numbers) are dropped.
    if (typeof accelerator === 'string') {
      result[actionId] = accelerator;
    }
  }
  return result;
}

const FONT_WEIGHT_STRINGS = [
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
] as const;

function pickFontWeight(value: unknown, fallback: FontWeight): FontWeight {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    // Accept xterm-style keywords as aliases for the canonical numeric weights so a hand-edited
    // settings.json with `"normal"` / `"bold"` round-trips to the equivalent numeric value.
    if (normalized === 'normal') {
      return '400';
    }
    if (normalized === 'bold') {
      return '700';
    }
    if ((FONT_WEIGHT_STRINGS as readonly string[]).includes(normalized)) {
      return normalized as FontWeight;
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const asString = String(value);
    if ((FONT_WEIGHT_STRINGS as readonly string[]).includes(asString)) {
      return asString as FontWeight;
    }
  }
  return fallback;
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
  const shellIntegrationRaw = isPlainObject(raw.shellIntegration) ? raw.shellIntegration : {};

  const terminal: AppSettings['terminal'] = {
    cursorStyle: pickCursorStyle(terminalRaw.cursorStyle, defaults.terminal.cursorStyle),
    cursorBlink: pickBoolean(terminalRaw.cursorBlink, defaults.terminal.cursorBlink),
    macOptionIsMeta: pickBoolean(terminalRaw.macOptionIsMeta, defaults.terminal.macOptionIsMeta),
    copyOnSelect: pickBoolean(terminalRaw.copyOnSelect, defaults.terminal.copyOnSelect),
    fontSize: Math.min(
      100,
      Math.max(6, pickFiniteNumber(terminalRaw.fontSize, defaults.terminal.fontSize)),
    ),
    fontFamily:
      typeof terminalRaw.fontFamily === 'string' && terminalRaw.fontFamily.length > 0
        ? terminalRaw.fontFamily
        : defaults.terminal.fontFamily,
    fontWeight: pickFontWeight(terminalRaw.fontWeight, defaults.terminal.fontWeight),
    fontWeightBold: pickFontWeight(terminalRaw.fontWeightBold, defaults.terminal.fontWeightBold),
  };

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
      // Layer user overrides on top of defaults so default bindings apply unless explicitly
      // overridden. A user-provided empty string surfaces here as `""` and signals "explicitly
      // unbound"; downstream runtime consumers must treat `""` as "no binding" rather than
      // attempting to register an empty accelerator.
      keybindings: {
        ...defaults.shortcuts.keybindings,
        ...pickKeybindings(shortcutsRaw.keybindings),
      },
    },
    app: {
      quitConfirm: pickQuitConfirm(appRaw.quitConfirm, defaults.app.quitConfirm),
    },
    shellIntegration: {
      autoInject: pickBoolean(shellIntegrationRaw.autoInject, defaults.shellIntegration.autoInject),
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
 * Returns the entries of `current` whose values differ from `defaultValue`, by `Object.is`
 * comparison on each top-level field. The result preserves field types via `Partial<T>`.
 *
 * Used to project the in-memory {@link AppSettings} down to its sparse on-disk form so that
 * `settings.json` only contains fields the user actively changed.
 */
function diffPrimitives<T extends object>(current: T, defaultValue: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(defaultValue) as Array<keyof T>) {
    if (!Object.is(current[key], defaultValue[key])) {
      result[key] = current[key];
    }
  }
  return result;
}

/**
 * Returns only the keybinding entries whose accelerator differs from the default for that action id.
 *
 * Semantics:
 *  - Same value as default: dropped (already implied by defaults at read time).
 *  - Different non-empty value: kept (an override).
 *  - Empty string against a defined default: kept (an explicit unbind).
 *  - Empty string against an undefined default: dropped (no-op — unbinding nothing is meaningless).
 */
function diffKeybindings(
  current: Record<string, string>,
  defaultValue: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [actionId, accelerator] of Object.entries(current)) {
    const defaultAccel = defaultValue[actionId];
    if (defaultAccel === accelerator) {
      continue;
    }
    if (defaultAccel === undefined && accelerator === '') {
      continue;
    }
    result[actionId] = accelerator;
  }
  return result;
}

/**
 * Projects the in-memory {@link AppSettings} to its sparse on-disk form by stripping fields that
 * match `DEFAULT_APP_SETTINGS`. Sections that match defaults entirely are omitted; an unmodified
 * settings tree returns `{}`.
 *
 * `activateAppHotkey: null` (= globally disabled) is intentionally kept when defaults expect a
 * non-null accelerator: `null` and the default string are different values, so the field is
 * persisted explicitly to record the user's intent rather than letting defaults fill it back in.
 */
function diffAgainstDefaults(settings: AppSettings): PersistedSettings {
  const defaults = DEFAULT_APP_SETTINGS;
  const result: PersistedSettings = {};

  const terminal = diffPrimitives(settings.terminal, defaults.terminal);
  if (Object.keys(terminal).length > 0) {
    result.terminal = terminal;
  }

  const paneInfo = diffPrimitives(settings.paneInfo, defaults.paneInfo);
  if (Object.keys(paneInfo).length > 0) {
    result.paneInfo = paneInfo;
  }

  const shortcutsDiff: Partial<AppSettings['shortcuts']> = {};
  if (!Object.is(settings.shortcuts.activateAppHotkey, defaults.shortcuts.activateAppHotkey)) {
    shortcutsDiff.activateAppHotkey = settings.shortcuts.activateAppHotkey;
  }
  const keybindings = diffKeybindings(
    settings.shortcuts.keybindings,
    defaults.shortcuts.keybindings,
  );
  if (Object.keys(keybindings).length > 0) {
    shortcutsDiff.keybindings = keybindings;
  }
  if (Object.keys(shortcutsDiff).length > 0) {
    result.shortcuts = shortcutsDiff;
  }

  const app = diffPrimitives(settings.app, defaults.app);
  if (Object.keys(app).length > 0) {
    result.app = app;
  }

  const shellIntegration = diffPrimitives(settings.shellIntegration, defaults.shellIntegration);
  if (Object.keys(shellIntegration).length > 0) {
    result.shellIntegration = shellIntegration;
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
    shellIntegration: patch.shellIntegration
      ? (mergeSection(
          current.shellIntegration as Record<string, unknown>,
          patch.shellIntegration as Record<string, unknown>,
        ) as AppSettings['shellIntegration'])
      : current.shellIntegration,
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
    // Persist the normalized diff so a hand-edited settings.json with typoed or default-valued keys
    // gets canonicalized to its sparse form on first launch. Legacy shape migrations are
    // intentionally not supported.
    this.storage.setSettings(diffAgainstDefaults(this.settings));
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
    this.storage.setSettings(diffAgainstDefaults(next));
    this.notify();
    return next;
  }

  /** Replaces persisted settings with built-in defaults and returns them. */
  public reset(): AppSettings {
    const next = cloneDefaultSettings();
    this.settings = next;
    // Defaults diffed against themselves yields `{}`, so the on-disk file is emptied on reset.
    this.storage.setSettings(diffAgainstDefaults(next));
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
    // Re-canonicalize the file to its sparse form so an external edit containing default-valued
    // fields or typos is cleaned up on the next reload.
    this.storage.setSettings(diffAgainstDefaults(this.settings));
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
