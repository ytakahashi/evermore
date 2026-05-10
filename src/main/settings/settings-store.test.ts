import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';
import { SettingsStore } from './settings-store';
import type { SettingsStorageAdapter } from './types';

class MemorySettingsStorageAdapter implements SettingsStorageAdapter {
  public payload: unknown;
  public filePath: string;

  public constructor(initial: unknown = {}, filePath = '/tmp/evermore/settings.json') {
    this.payload = initial;
    this.filePath = filePath;
  }

  public getSettings(): unknown {
    return this.payload;
  }

  public setSettings(settings: AppSettings): void {
    this.payload = settings;
  }

  public getFilePath(): string {
    return this.filePath;
  }
}

describe('SettingsStore', () => {
  let storage: MemorySettingsStorageAdapter;
  let store: SettingsStore;

  beforeEach(() => {
    storage = new MemorySettingsStorageAdapter();
    store = new SettingsStore({ storage });
  });

  it('initializes with defaults when storage is empty', () => {
    // Given: a freshly created store on top of an empty payload.

    // When: the renderer reads settings.
    const result = store.get();

    // Then: defaults are returned and persisted back so the file reflects the canonical shape.
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
    expect(storage.payload).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('persists an update and returns the resulting full settings', () => {
    // Given: defaults are in storage.

    // When: the renderer updates one nested field.
    const next = store.update({ terminal: { cursorStyle: 'underline' } });

    // Then: the returned object reflects the change and the file mirrors it.
    expect(next.terminal.cursorStyle).toBe('underline');
    expect(next.terminal.cursorBlink).toBe(DEFAULT_APP_SETTINGS.terminal.cursorBlink);
    expect((storage.payload as AppSettings).terminal.cursorStyle).toBe('underline');
  });

  it('notifies subscribers after a successful update', () => {
    // Given: a registered subscriber.
    const listener = vi.fn();
    store.subscribe(listener);

    // When: settings are updated.
    store.update({ paneInfo: { pollIntervalMs: 500 } });

    // Then: the listener receives the new full settings.
    expect(listener).toHaveBeenCalledOnce();
    const received = listener.mock.calls[0]?.[0] as AppSettings;
    expect(received.paneInfo.pollIntervalMs).toBe(500);
  });

  it('reset() returns to defaults regardless of prior updates', () => {
    // Given: settings have drifted from defaults.
    store.update({ app: { quitConfirm: 'never' } });

    // When: the user resets to defaults.
    const next = store.reset();

    // Then: defaults are restored both in memory and on disk.
    expect(next).toEqual(DEFAULT_APP_SETTINGS);
    expect(storage.payload).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('reload() re-runs migrations against the current storage payload', () => {
    // Given: an external editor has written a value into the underlying storage.
    storage.payload = {
      terminal: { cursorStyle: 'block', macOptionIsMeta: false },
      app: { quitConfirm: 'always' },
    };

    // When: the renderer asks the store to reload.
    const next = store.reload();

    // Then: the in-memory cache catches up and missing fields are filled with defaults.
    expect(next.terminal.cursorStyle).toBe('block');
    expect(next.terminal.macOptionIsMeta).toBe(false);
    expect(next.app.quitConfirm).toBe('always');
    expect(next.paneInfo.pollIntervalMs).toBe(DEFAULT_APP_SETTINGS.paneInfo.pollIntervalMs);
  });

  it('exposes the storage file path for the About section', () => {
    // Given: the storage advertises a known path.

    // When: the renderer asks for the file path.
    const filePath = store.getFilePath();

    // Then: the storage path is forwarded as-is.
    expect(filePath).toBe('/tmp/evermore/settings.json');
  });

  it('isolates one subscriber error so other subscribers still run', () => {
    // Given: two subscribers, the first of which throws.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    store.subscribe(failing);
    store.subscribe(ok);

    // When: an update fires both subscribers.
    store.update({ terminal: { copyOnSelect: false } });

    // Then: the failure is logged but the second subscriber still receives the update.
    expect(failing).toHaveBeenCalledOnce();
    expect(ok).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
