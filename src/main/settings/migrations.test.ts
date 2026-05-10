import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import { applySettingsPatch, migrateSettings } from './migrations';

describe('migrateSettings', () => {
  it('returns defaults when storage payload is empty or invalid', () => {
    // Given: a freshly initialized store has no persisted payload, or the payload was tampered with.

    // When: migration runs against a non-object value.
    const fromUndefined = migrateSettings(undefined);
    const fromNull = migrateSettings(null);
    const fromString = migrateSettings('hello');

    // Then: all variants converge on the documented defaults.
    expect(fromUndefined).toEqual(DEFAULT_APP_SETTINGS);
    expect(fromNull).toEqual(DEFAULT_APP_SETTINGS);
    expect(fromString).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('drops legacy ui section while preserving valid sibling fields', () => {
    // Given: a payload from the previous AppSettings shape with `ui` populated.
    const legacyPayload = {
      ui: {
        sidebarOpen: false,
        sidebarWidth: 320,
        sidebarView: 'connections',
      },
      terminal: {
        fontSize: 14,
        fontFamily: 'Fira Code',
        cursorStyle: 'block',
      },
    };

    // When: migration runs.
    const migrated = migrateSettings(legacyPayload);

    // Then: the ui section is dropped and persisted terminal values are kept.
    expect(migrated.terminal.cursorStyle).toBe('block');
    expect(migrated.terminal.fontSize).toBe(14);
    expect(migrated.terminal.fontFamily).toBe('Fira Code');
    expect(migrated).not.toHaveProperty('ui');
  });

  it('coerces invalid cursorStyle values back to the default', () => {
    // Given: a payload with an out-of-range cursor style value (e.g. user typo).
    const payload = {
      terminal: { cursorStyle: 'circle' },
    };

    // When: migration runs.
    const migrated = migrateSettings(payload);

    // Then: the default is restored.
    expect(migrated.terminal.cursorStyle).toBe(DEFAULT_APP_SETTINGS.terminal.cursorStyle);
  });

  it('keeps non-default boolean values when explicitly set to false', () => {
    // Given: a payload that has explicitly disabled a boolean preference.
    const payload = {
      terminal: { copyOnSelect: false, macOptionIsMeta: false, cursorBlink: false },
    };

    // When: migration runs.
    const migrated = migrateSettings(payload);

    // Then: each false value is preserved instead of being replaced by the true default.
    expect(migrated.terminal.copyOnSelect).toBe(false);
    expect(migrated.terminal.macOptionIsMeta).toBe(false);
    expect(migrated.terminal.cursorBlink).toBe(false);
  });

  it('rejects non-positive pollIntervalMs and falls back to default', () => {
    // Given: a payload with an invalid poll interval (zero / negative / non-finite).
    const payload = {
      paneInfo: { pollIntervalMs: 0 },
    };

    // When: migration runs.
    const migrated = migrateSettings(payload);

    // Then: the default poll interval is used.
    expect(migrated.paneInfo.pollIntervalMs).toBe(DEFAULT_APP_SETTINGS.paneInfo.pollIntervalMs);
  });

  it('preserves an explicit null hotkey to mean disabled', () => {
    // Given: the user has disabled the global hotkey.
    const payload = {
      shortcuts: { activateAppHotkey: null },
    };

    // When: migration runs.
    const migrated = migrateSettings(payload);

    // Then: the disabled state is preserved (not replaced by the default chord).
    expect(migrated.shortcuts.activateAppHotkey).toBeNull();
  });

  it('drops non-string keybinding entries', () => {
    // Given: a payload where some keybindings are malformed.
    const payload = {
      shortcuts: {
        keybindings: {
          'workspace.next': 'Cmd+Shift+]',
          'workspace.prev': 42,
          'pane.split': '',
        },
      },
    };

    // When: migration runs.
    const migrated = migrateSettings(payload);

    // Then: only valid string entries survive.
    expect(migrated.shortcuts.keybindings).toEqual({
      'workspace.next': 'Cmd+Shift+]',
    });
  });
});

describe('applySettingsPatch', () => {
  it('merges a partial section without dropping unrelated fields', () => {
    // Given: a fully-populated settings object.
    const current = structuredClone(DEFAULT_APP_SETTINGS);

    // When: a patch updates only one terminal field.
    const next = applySettingsPatch(current, { terminal: { copyOnSelect: false } });

    // Then: the targeted field changes while sibling fields and other sections are preserved.
    expect(next.terminal.copyOnSelect).toBe(false);
    expect(next.terminal.cursorStyle).toBe(current.terminal.cursorStyle);
    expect(next.paneInfo).toBe(current.paneInfo);
    expect(next.app).toBe(current.app);
  });

  it('returns a new object so optimistic-update flows can compare references', () => {
    // Given: a fully-populated settings object.
    const current = structuredClone(DEFAULT_APP_SETTINGS);

    // When: a patch is applied.
    const next = applySettingsPatch(current, { app: { quitConfirm: 'never' } });

    // Then: the top-level reference changes (so React / zustand selectors detect the update).
    expect(next).not.toBe(current);
    expect(next.app.quitConfirm).toBe('never');
  });

  it('ignores undefined patch fields rather than overwriting with undefined', () => {
    // Given: a settings object with the default poll interval.
    const current = structuredClone(DEFAULT_APP_SETTINGS);

    // When: a patch carries an explicit `undefined` field.
    const next = applySettingsPatch(current, { paneInfo: { pollIntervalMs: undefined } });

    // Then: the persisted value is left intact.
    expect(next.paneInfo.pollIntervalMs).toBe(current.paneInfo.pollIntervalMs);
  });
});
