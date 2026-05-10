import type { AppSettings } from '../../shared/types';

/**
 * Storage adapter for the main-process settings store.
 *
 * The default adapter writes through `electron-store` to `~/.config/evermore/settings.json`.
 * Tests can substitute an in-memory adapter to drive the SettingsStore deterministically without
 * touching the filesystem (mirrors the WorkspaceStorageAdapter pattern in workspace/types.ts).
 */
export interface SettingsStorageAdapter {
  getSettings: () => unknown;
  setSettings: (settings: AppSettings) => void;
  /** Returns the absolute path to the persisted settings file. */
  getFilePath: () => string;
}

export interface SettingsStoreOptions {
  storage?: SettingsStorageAdapter;
}
