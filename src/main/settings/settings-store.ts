import { homedir } from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import type { SettingsUpdate } from '../../shared/api-types';
import { cloneDefaultSettings, DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';
import { applySettingsPatch, migrateSettings } from './migrations';
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

/**
 * Persists user preferences and exposes change notifications for runtime reactors.
 *
 * The store keeps an in-memory copy of the migrated settings so reads do not re-parse storage on
 * every IPC call. Writes go through `update()` / `reset()`, which both persist and broadcast to
 * subscribers (e.g. main-side reactors that need to push values into runtime services).
 */
export class SettingsStore {
  private readonly storage: SettingsStorageAdapter;
  private settings: AppSettings;
  private readonly subscribers = new Set<(settings: AppSettings) => void>();

  public constructor(options: SettingsStoreOptions = {}) {
    this.storage = options.storage ?? new ElectronSettingsStorageAdapter();
    this.settings = migrateSettings(this.storage.getSettings());
    // Persist normalized values so a hand-edited settings.json with legacy / typoed keys gets
    // canonicalized on first launch.
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
    const next = migrateSettings(applySettingsPatch(this.settings, patch));
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
   * file directly. It also re-runs migrations so legacy / typoed keys get normalized.
   */
  public reload(): AppSettings {
    this.settings = migrateSettings(this.storage.getSettings());
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
