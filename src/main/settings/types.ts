import type { AppSettings } from '../../shared/types';

/**
 * Sparse on-disk representation of {@link AppSettings}.
 *
 * Only fields that differ from `DEFAULT_APP_SETTINGS` are persisted; missing keys fall back to
 * defaults on read. Sections that match defaults entirely are omitted. The in-memory and IPC
 * shape remains the full {@link AppSettings} — this type is the disk-format only.
 */
export type PersistedSettings = {
  [Section in keyof AppSettings]?: Partial<AppSettings[Section]>;
};

/**
 * Storage adapter for the main-process settings store.
 *
 * The default adapter writes through `electron-store` to `~/.config/evermore/settings.json`.
 * Tests can substitute an in-memory adapter to drive the SettingsStore deterministically without
 * touching the filesystem (mirrors the WorkspaceStorageAdapter pattern in workspace/types.ts).
 */
export interface SettingsStorageAdapter {
  getSettings: () => unknown;
  setSettings: (settings: PersistedSettings) => void;
  /** Returns the absolute path to the persisted settings file. */
  getFilePath: () => string;
}

export interface SettingsStoreOptions {
  storage?: SettingsStorageAdapter;
}
