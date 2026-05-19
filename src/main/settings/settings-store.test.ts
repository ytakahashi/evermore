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

  it('normalizes invalid update values before persisting', () => {
    // Given: a malformed value reaches the store through an IPC boundary or future UI bug.

    // When: the update is applied.
    const next = store.update({
      terminal: { cursorStyle: 'circle' as AppSettings['terminal']['cursorStyle'] },
    });

    // Then: the invalid value is rejected before it reaches disk.
    expect(next.terminal.cursorStyle).toBe(DEFAULT_APP_SETTINGS.terminal.cursorStyle);
    expect((storage.payload as AppSettings).terminal.cursorStyle).toBe(
      DEFAULT_APP_SETTINGS.terminal.cursorStyle,
    );
  });

  it('persists non-positive pollIntervalMs values so polling can be disabled', () => {
    // Given: the user wants to disable pane-info polling.

    // When: poll interval is set to zero.
    const next = store.update({ paneInfo: { pollIntervalMs: 0 } });

    // Then: the disable value is kept.
    expect(next.paneInfo.pollIntervalMs).toBe(0);
    expect((storage.payload as AppSettings).paneInfo.pollIntervalMs).toBe(0);
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

  it('reload() re-reads and normalizes the current settings payload', () => {
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

  it('drops unknown sections while preserving valid sibling fields', () => {
    // Given: a payload with an unknown section and valid current-shape settings.
    storage.payload = {
      ui: { sidebarOpen: false },
      terminal: { fontSize: 14, cursorStyle: 'block' },
    };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: unknown sections are dropped while valid sibling values are kept.
    expect(next.terminal.cursorStyle).toBe('block');
    expect(next.terminal.fontSize).toBe(14);
    expect(next).not.toHaveProperty('ui');
  });

  it('coerces invalid cursorStyle values back to the default when read from storage', () => {
    // Given: a persisted payload with an out-of-range cursor style value.
    storage.payload = { terminal: { cursorStyle: 'circle' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the default cursor style is restored.
    expect(next.terminal.cursorStyle).toBe(DEFAULT_APP_SETTINGS.terminal.cursorStyle);
  });

  it('keeps non-default boolean values when explicitly set to false when read from storage', () => {
    // Given: persisted boolean preferences explicitly set to false.
    storage.payload = { terminal: { copyOnSelect: false, cursorBlink: false } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: false is preserved instead of being replaced by the true default.
    expect(next.terminal.copyOnSelect).toBe(false);
    expect(next.terminal.cursorBlink).toBe(false);
  });

  it('enforces a minimum font size of 6px when read from storage', () => {
    // Given: a persisted font size below the allowed floor.
    storage.payload = { terminal: { fontSize: 2 } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the floor is applied.
    expect(next.terminal.fontSize).toBe(6);
  });

  it('enforces a maximum font size of 100px when read from storage', () => {
    // Given: a persisted font size above the allowed ceiling.
    storage.payload = { terminal: { fontSize: 999 } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the ceiling is applied.
    expect(next.terminal.fontSize).toBe(100);
  });

  it('normalizes invalid font weight strings to defaults when read from storage', () => {
    // Given: a persisted font weight with an invalid string format.
    storage.payload = { terminal: { fontWeight: '100abc' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the default font weight is restored.
    expect(next.terminal.fontWeight).toBe(DEFAULT_APP_SETTINGS.terminal.fontWeight);
  });

  it('normalizes the legacy "normal" / "bold" keywords to their numeric equivalents', () => {
    // Given: a hand-edited font weight keyword with whitespace and uppercase letters.
    storage.payload = { terminal: { fontWeight: ' Normal ', fontWeightBold: ' Bold ' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: keywords are canonicalized to their numeric equivalents.
    expect(next.terminal.fontWeight).toBe('400');
    expect(next.terminal.fontWeightBold).toBe('700');
  });

  it('trims and preserves valid numeric font weight strings when read from storage', () => {
    // Given: a hand-edited numeric font weight string with surrounding whitespace.
    storage.payload = { terminal: { fontWeight: ' 300 ', fontWeightBold: ' 900 ' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: trimmed string values are preserved.
    expect(next.terminal.fontWeight).toBe('300');
    expect(next.terminal.fontWeightBold).toBe('900');
  });

  it('normalizes canonical numeric font weights to strings when read from storage', () => {
    // Given: a persisted numeric font weight matching a canonical step.
    storage.payload = { terminal: { fontWeight: 500 } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the numeric value is normalized to its string equivalent.
    expect(next.terminal.fontWeight).toBe('500');
  });

  it('rejects non-canonical numeric font weights when read from storage', () => {
    // Given: a persisted numeric font weight outside the 100/200/.../900 set.
    storage.payload = { terminal: { fontWeight: 450 } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: it falls back to default.
    expect(next.terminal.fontWeight).toBe(DEFAULT_APP_SETTINGS.terminal.fontWeight);
  });

  it('rejects non-finite pollIntervalMs and falls back to default when read from storage', () => {
    // Given: a persisted payload with an invalid non-finite poll interval.
    storage.payload = { paneInfo: { pollIntervalMs: Number.NaN } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the default poll interval is used.
    expect(next.paneInfo.pollIntervalMs).toBe(DEFAULT_APP_SETTINGS.paneInfo.pollIntervalMs);
  });

  it('preserves an explicit null hotkey to mean disabled when read from storage', () => {
    // Given: the user has persisted a disabled global hotkey.
    storage.payload = { shortcuts: { activateAppHotkey: null } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the disabled state is preserved.
    expect(next.shortcuts.activateAppHotkey).toBeNull();
  });

  it('drops non-string keybinding entries when read from storage', () => {
    // Given: persisted keybindings contain valid and malformed entries.
    storage.payload = {
      shortcuts: {
        keybindings: {
          'workspace.next': 'Cmd+Shift+]',
          'workspace.prev': 42,
          'pane.split': '',
        },
      },
    };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: only non-empty string accelerators survive.
    expect(next.shortcuts.keybindings).toEqual({
      'workspace.next': 'Cmd+Shift+]',
    });
  });

  it('ignores undefined patch fields rather than overwriting with undefined', () => {
    // Given: a store initialized with the default poll interval.

    // When: a patch carries an explicit undefined field.
    const next = store.update({ paneInfo: { pollIntervalMs: undefined } });

    // Then: the persisted value is left intact.
    expect(next.paneInfo.pollIntervalMs).toBe(DEFAULT_APP_SETTINGS.paneInfo.pollIntervalMs);
  });

  it('defaults shellIntegration.autoInject to true when storage is empty', () => {
    // Given: a freshly created store on top of an empty payload.

    // When: the renderer reads settings.
    const result = store.get();

    // Then: auto-inject ships ON by default (Phase 5 design).
    expect(result.shellIntegration.autoInject).toBe(true);
  });

  it('persists an explicit shellIntegration.autoInject=false update', () => {
    // Given: defaults are in storage.

    // When: the user disables auto-injection.
    const next = store.update({ shellIntegration: { autoInject: false } });

    // Then: the value flips and the file mirrors it without touching unrelated sections.
    expect(next.shellIntegration.autoInject).toBe(false);
    expect((storage.payload as AppSettings).shellIntegration.autoInject).toBe(false);
    expect(next.terminal).toEqual(DEFAULT_APP_SETTINGS.terminal);
  });

  it('normalizes a typoed shellIntegration.autoInject value back to the default', () => {
    // Given: a hand-edited settings.json with a non-boolean value.
    storage.payload = { shellIntegration: { autoInject: 'yes' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the canonical default is restored.
    expect(next.shellIntegration.autoInject).toBe(DEFAULT_APP_SETTINGS.shellIntegration.autoInject);
  });

  it('fills in a missing shellIntegration section with defaults when read from storage', () => {
    // Given: a legacy settings.json predating the shellIntegration section.
    storage.payload = { terminal: { cursorStyle: 'block' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the section is populated with defaults so downstream consumers can read it.
    expect(next.shellIntegration).toEqual(DEFAULT_APP_SETTINGS.shellIntegration);
  });
});
