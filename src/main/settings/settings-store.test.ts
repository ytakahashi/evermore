import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';
import { createLogger, type LogRecord, type LogTransport } from '../logging/logger';
import { SettingsStore } from './settings-store';
import type { PersistedSettings, SettingsStorageAdapter } from './types';

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

  public setSettings(settings: PersistedSettings): void {
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

  it('initializes with defaults in memory and persists an empty file when storage is empty', () => {
    // Given: a freshly created store on top of an empty payload.

    // When: the renderer reads settings.
    const result = store.get();

    // Then: defaults are returned in-memory while disk stays empty — defaults are not persisted.
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
    expect(storage.payload).toEqual({});
  });

  it('persists only the changed field while returning the resulting full settings', () => {
    // Given: defaults are in storage.

    // When: the renderer updates one nested field.
    const next = store.update({ terminal: { cursorStyle: 'underline' } });

    // Then: the returned object is fully populated, but the on-disk payload contains only the diff.
    expect(next.terminal.cursorStyle).toBe('underline');
    expect(next.terminal.cursorBlink).toBe(DEFAULT_APP_SETTINGS.terminal.cursorBlink);
    expect(storage.payload).toEqual({ terminal: { cursorStyle: 'underline' } });
  });

  it('normalizes invalid update values and keeps the file empty when no field actually changed', () => {
    // Given: a malformed value reaches the store through an IPC boundary or future UI bug.

    // When: the update is applied.
    const next = store.update({
      terminal: { cursorStyle: 'circle' as AppSettings['terminal']['cursorStyle'] },
    });

    // Then: the invalid value is rejected, so no field differs from defaults and the file stays empty.
    expect(next.terminal.cursorStyle).toBe(DEFAULT_APP_SETTINGS.terminal.cursorStyle);
    expect(storage.payload).toEqual({});
  });

  it('persists non-positive pollIntervalMs values so polling can be disabled', () => {
    // Given: the user wants to disable pane-info polling.

    // When: poll interval is set to zero.
    const next = store.update({ paneInfo: { pollIntervalMs: 0 } });

    // Then: the disable value is kept and only the diff lands on disk.
    expect(next.paneInfo.pollIntervalMs).toBe(0);
    expect(storage.payload).toEqual({ paneInfo: { pollIntervalMs: 0 } });
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

    // Then: defaults are restored in memory and the on-disk file is emptied.
    expect(next).toEqual(DEFAULT_APP_SETTINGS);
    expect(storage.payload).toEqual({});
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
    // Given: a store with a recording logger and two subscribers, the first of which throws.
    const records: LogRecord[] = [];
    const recordingTransport: LogTransport = {
      write(record) {
        records.push(record);
      },
    };
    const logger = createLogger({ level: 'debug', transport: recordingTransport });
    const failingStorage = new MemorySettingsStorageAdapter();
    const failingStore = new SettingsStore({ storage: failingStorage, logger });
    const thrown = new Error('boom');
    const failing = vi.fn(() => {
      throw thrown;
    });
    const ok = vi.fn();
    failingStore.subscribe(failing);
    failingStore.subscribe(ok);

    // When: an update fires both subscribers.
    failingStore.update({ terminal: { copyOnSelect: false } });

    // Then: the failure is routed to the injected logger but the second subscriber still runs.
    expect(failing).toHaveBeenCalledOnce();
    expect(ok).toHaveBeenCalledOnce();
    expect(records).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'SettingsStore subscriber threw',
        meta: thrown,
      }),
    ]);
  });

  it('does not touch console when no logger is injected and a subscriber throws', () => {
    // Given: a store with no logger override and a console.error spy in place.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const defaultStorage = new MemorySettingsStorageAdapter();
    const defaultStore = new SettingsStore({ storage: defaultStorage });
    defaultStore.subscribe(() => {
      throw new Error('boom');
    });

    // When: an update triggers the failing subscriber.
    defaultStore.update({ terminal: { copyOnSelect: false } });

    // Then: the silent default logger swallows the diagnostic — console stays quiet.
    expect(errorSpy).not.toHaveBeenCalled();
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

  it('drops non-string keybinding entries while preserving "" as an explicit unbind', () => {
    // Given: persisted keybindings contain valid, non-string, and explicit-unbind entries.
    storage.payload = {
      shortcuts: {
        keybindings: {
          'workspace.nextTab': 'Command+Shift+]',
          'workspace.previousTab': 42,
          'pane.splitVertical': '',
        },
      },
    };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: non-strings are dropped; the user override and the explicit unbind both survive on top
    // of the default-merged map (default values remain for ids the user did not touch).
    expect(next.shortcuts.keybindings['workspace.nextTab']).toBe('Command+Shift+]');
    expect(next.shortcuts.keybindings['workspace.previousTab']).toBe(
      DEFAULT_APP_SETTINGS.shortcuts.keybindings['workspace.previousTab'],
    );
    expect(next.shortcuts.keybindings['pane.splitVertical']).toBe('');
  });

  it('drops unknown action ids from the keybinding map on reload', () => {
    // Given: a hand-edited settings.json with a typo or a removed action id.
    storage.payload = {
      shortcuts: {
        keybindings: {
          'workspace.nonexistent': 'Command+Shift+X',
          'workspace.newTab': 'Command+Shift+T',
        },
      },
    };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the unknown entry is removed entirely and never reaches the resolved settings.
    expect(next.shortcuts.keybindings['workspace.newTab']).toBe('Command+Shift+T');
    expect(next.shortcuts.keybindings).not.toHaveProperty('workspace.nonexistent');
    // The canonicalized on-disk shape drops the unknown id as well.
    const persisted = storage.payload as { shortcuts?: { keybindings?: Record<string, string> } };
    expect(persisted.shortcuts?.keybindings).toEqual({
      'workspace.newTab': 'Command+Shift+T',
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

    // Then: the value flips and the file mirrors only that single field.
    expect(next.shellIntegration.autoInject).toBe(false);
    expect(storage.payload).toEqual({ shellIntegration: { autoInject: false } });
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

  it('omits fields whose update value matches the default', () => {
    // Given: the user has drifted one field away from defaults.
    store.update({ terminal: { cursorStyle: 'underline' } });
    expect(storage.payload).toEqual({ terminal: { cursorStyle: 'underline' } });

    // When: the user reverts the field to its default value.
    store.update({ terminal: { cursorStyle: DEFAULT_APP_SETTINGS.terminal.cursorStyle } });

    // Then: the file is empty again — defaults are not materialized on disk.
    expect(storage.payload).toEqual({});
  });

  it('persists activateAppHotkey=null as an explicit field to record the "disabled" intent', () => {
    // Given: defaults are in storage and the default hotkey is a non-null accelerator.

    // When: the user disables the global hotkey.
    const next = store.update({ shortcuts: { activateAppHotkey: null } });

    // Then: null reaches both memory and disk (distinct from "field absent, fall back to default").
    expect(next.shortcuts.activateAppHotkey).toBeNull();
    expect(storage.payload).toEqual({ shortcuts: { activateAppHotkey: null } });
  });

  it('persists only the user-set keybinding entries that differ from defaults', () => {
    // Given: defaults are in storage.

    // When: the user overrides one binding to a non-default accelerator.
    store.update({ shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+T' } } });

    // Then: only the changed entry is persisted; every other default stays implicit.
    expect(storage.payload).toEqual({
      shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+T' } },
    });
  });

  it('drops an unknown-id "" entry instead of persisting noise', () => {
    // Given: the user "unbinds" an action id that does not exist in the closed action id set.

    // When: the update is applied.
    store.update({ shortcuts: { keybindings: { 'workspace.nonexistent': '' } } });

    // Then: the unknown id is dropped at the boundary and the file stays empty.
    expect(storage.payload).toEqual({});
  });

  it('canonicalizes a hand-edited unknown-id entry to the empty file on reload', () => {
    // Given: settings.json has been hand-edited with an entry for a non-existent action id.
    storage.payload = { shortcuts: { keybindings: { 'workspace.nonexistent': '' } } };

    // When: the store reloads from disk.
    store.reload();

    // Then: the unknown id is dropped and the file is cleaned up.
    expect(storage.payload).toEqual({});
  });

  it('persists "" as an explicit unbind for an action id with a defined default', () => {
    // Given: defaults bind `workspace.newTab` to a non-empty accelerator.

    // When: the user explicitly unbinds it.
    const next = store.update({ shortcuts: { keybindings: { 'workspace.newTab': '' } } });

    // Then: the empty-string accelerator surfaces in resolved settings and on disk as an override.
    expect(next.shortcuts.keybindings['workspace.newTab']).toBe('');
    expect(storage.payload).toEqual({
      shortcuts: { keybindings: { 'workspace.newTab': '' } },
    });
  });

  it('canonicalizes a fully-populated legacy file down to its sparse form on construction', () => {
    // Given: a settings.json from before sparse persistence — every default is materialized.
    storage.payload = structuredClone(DEFAULT_APP_SETTINGS);

    // When: the SettingsStore boots against that file.
    const local = new SettingsStore({ storage });

    // Then: the in-memory shape is unchanged, but disk is emptied because nothing diverges.
    expect(local.get()).toEqual(DEFAULT_APP_SETTINGS);
    expect(storage.payload).toEqual({});
  });

  it('fills in a missing shellIntegration section with defaults when read from storage', () => {
    // Given: a legacy settings.json predating the shellIntegration section.
    storage.payload = { terminal: { cursorStyle: 'block' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the section is populated with defaults so downstream consumers can read it.
    expect(next.shellIntegration).toEqual(DEFAULT_APP_SETTINGS.shellIntegration);
  });

  it('defaults notifications.aiAgentAwaitingInputEnabled to false when storage is empty', () => {
    // Given: a freshly created store on top of an empty payload.

    // When: the renderer reads settings.
    const result = store.get();

    // Then: AI awaiting-input notifications are opt-in.
    expect(result.notifications.aiAgentAwaitingInputEnabled).toBe(false);
  });

  it('persists an explicit notifications.aiAgentAwaitingInputEnabled=true update', () => {
    // Given: defaults are in storage.

    // When: the user enables AI awaiting-input notifications.
    const next = store.update({ notifications: { aiAgentAwaitingInputEnabled: true } });

    // Then: only the diff lands on disk and other sections stay implicit.
    expect(next.notifications.aiAgentAwaitingInputEnabled).toBe(true);
    expect(storage.payload).toEqual({ notifications: { aiAgentAwaitingInputEnabled: true } });
  });

  it('normalizes a non-boolean notifications.aiAgentAwaitingInputEnabled to the default', () => {
    // Given: a hand-edited settings.json with a non-boolean value.
    storage.payload = { notifications: { aiAgentAwaitingInputEnabled: 'yes' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the canonical default is restored.
    expect(next.notifications.aiAgentAwaitingInputEnabled).toBe(
      DEFAULT_APP_SETTINGS.notifications.aiAgentAwaitingInputEnabled,
    );
  });

  it('fills in a missing notifications section with defaults when read from storage', () => {
    // Given: a legacy settings.json predating the notifications section.
    storage.payload = { terminal: { cursorStyle: 'block' } };

    // When: the store reloads from disk.
    const next = store.reload();

    // Then: the section is populated with defaults so downstream consumers can read it.
    expect(next.notifications).toEqual(DEFAULT_APP_SETTINGS.notifications);
  });
});
