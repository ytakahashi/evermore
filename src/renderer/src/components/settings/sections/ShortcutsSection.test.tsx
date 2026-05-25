import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_LABELS,
  DEFAULT_KEYBINDINGS,
  KEYBOARD_SHORTCUT_ACTION_IDS,
} from '../../../../../shared/keyboard-shortcuts';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { ShortcutsSection } from './ShortcutsSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

const DEBOUNCE_FLUSH_MS = 350;

describe('ShortcutsSection', () => {
  let fixture: SettingsApiFixture;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.teardown();
  });

  it('shows an inline error when the activate hotkey is rejected by main', async () => {
    // Given: main rejects the requested hotkey and returns the previous value. The fake's
    // updateImpl returns `current` unchanged so the renderer observes a no-op response and
    // surfaces the collision message.
    fixture = createSettingsApiFixture({ updateImpl: (current) => current });
    render(<ShortcutsSection />);

    // When: the user records a colliding shortcut.
    fireEvent.keyDown(screen.getByLabelText('Activate Evermore hotkey'), {
      key: ' ',
      code: 'Space',
      metaKey: true,
      shiftKey: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the picker reports the collision inline.
    expect(screen.getByText(/already used by another app/i)).toBeInTheDocument();
  });

  it('persists hotkey input as a macOS-style accelerator string', async () => {
    // Given: the Shortcuts section is visible with the default hotkey.
    fixture = createSettingsApiFixture();
    render(<ShortcutsSection />);

    // When: the user records Cmd+Option+Shift+, in the picker.
    fireEvent.keyDown(screen.getByLabelText('Activate Evermore hotkey'), {
      key: ',',
      code: 'Comma',
      metaKey: true,
      altKey: true,
      shiftKey: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the persisted accelerator uses macOS modifier labels, not the cross-platform token.
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: undefined,
      shortcuts: { activateAppHotkey: 'Command+Option+Shift+,' },
      app: undefined,
      shellIntegration: undefined,
    });
  });

  it('renders every default keybinding with its label and default accelerator', () => {
    // Given: defaults are the in-memory snapshot.
    fixture = createSettingsApiFixture();
    render(<ShortcutsSection />);

    // Then: every action id surfaces with the ACTION_LABELS title, the action id subtitle, and
    // the default accelerator value in its picker.
    for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
      const label = ACTION_LABELS[actionId];
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(actionId)).toBeInTheDocument();
      const picker = screen.getByLabelText(`${label} keybinding`) as HTMLInputElement;
      expect(picker.value).toBe(DEFAULT_KEYBINDINGS[actionId]);
    }
  });

  it('persists a rebound accelerator via updateSettings', async () => {
    // Given: defaults are loaded and the user focuses the New Tab keybinding row.
    fixture = createSettingsApiFixture();
    render(<ShortcutsSection />);

    // When: the user records Cmd+Shift+T.
    fireEvent.keyDown(screen.getByLabelText('New Tab keybinding'), {
      key: 'T',
      code: 'KeyT',
      metaKey: true,
      shiftKey: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the update flushes the new accelerator alongside the unchanged defaults.
    expect(fixture.api.update).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(fixture.api.update).mock.calls[0]?.[0];
    expect(patch?.shortcuts?.keybindings).toMatchObject({
      'workspace.newTab': 'Command+Shift+T',
    });
  });

  it('routes Backspace through updateSettings as a "restore default" by dropping the override', async () => {
    // Given: the user has previously overridden New Tab to a non-default accelerator.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shortcuts: {
          ...DEFAULT_APP_SETTINGS.shortcuts,
          keybindings: {
            ...DEFAULT_APP_SETTINGS.shortcuts.keybindings,
            'workspace.newTab': 'Command+Shift+T',
          },
        },
      },
    });
    render(<ShortcutsSection />);

    // When: the user presses Backspace on the row.
    fireEvent.keyDown(screen.getByLabelText('New Tab keybinding'), { key: 'Backspace' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the persisted patch no longer carries that action id, so the next read merges the
    // default back in.
    expect(fixture.api.update).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(fixture.api.update).mock.calls[0]?.[0];
    expect(patch?.shortcuts?.keybindings).not.toHaveProperty('workspace.newTab');
  });

  it('renders an explicit-unbind ("") row as (disabled) and accepts only Backspace', async () => {
    // Given: the persisted settings contain an explicit unbind for New Tab (hand-edited only).
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shortcuts: {
          ...DEFAULT_APP_SETTINGS.shortcuts,
          keybindings: {
            ...DEFAULT_APP_SETTINGS.shortcuts.keybindings,
            'workspace.newTab': '',
          },
        },
      },
    });
    render(<ShortcutsSection />);

    // Then: the picker shows the (disabled) sentinel and is marked aria-disabled.
    const picker = screen.getByLabelText('New Tab keybinding') as HTMLInputElement;
    expect(picker.value).toBe('(disabled)');
    expect(picker.getAttribute('aria-disabled')).toBe('true');

    // When: a normal accelerator keystroke is sent — it must be ignored.
    fireEvent.keyDown(picker, { key: 'X', code: 'KeyX', metaKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });
    expect(fixture.api.update).not.toHaveBeenCalled();

    // When: the user presses Backspace.
    fireEvent.keyDown(picker, { key: 'Backspace' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the unbind is dropped (the default merges back in on next read).
    expect(fixture.api.update).toHaveBeenCalledTimes(1);
    const patch = vi.mocked(fixture.api.update).mock.calls[0]?.[0];
    expect(patch?.shortcuts?.keybindings).not.toHaveProperty('workspace.newTab');
  });

  it('warns when two actions are bound to the same accelerator without rejecting the save', async () => {
    // Given: New Tab and Close Tab share the same custom accelerator.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shortcuts: {
          ...DEFAULT_APP_SETTINGS.shortcuts,
          keybindings: {
            ...DEFAULT_APP_SETTINGS.shortcuts.keybindings,
            'workspace.newTab': 'Command+K',
            'workspace.closeTab': 'Command+K',
          },
        },
      },
    });
    render(<ShortcutsSection />);

    // Then: both rows display a warning pointing at the other action by label.
    const newTabRow = screen.getByLabelText('New Tab keybinding').closest('.grid');
    const closeTabRow = screen.getByLabelText('Close Tab keybinding').closest('.grid');
    expect(newTabRow).not.toBeNull();
    expect(closeTabRow).not.toBeNull();
    expect(within(newTabRow as HTMLElement).getByRole('alert').textContent).toContain('Close Tab');
    expect(within(closeTabRow as HTMLElement).getByRole('alert').textContent).toContain('New Tab');

    // When: the user rebinds New Tab to yet another value.
    fireEvent.keyDown(screen.getByLabelText('New Tab keybinding'), {
      key: 'J',
      code: 'KeyJ',
      metaKey: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_FLUSH_MS);
    });

    // Then: the conflict did not block the save — updateSettings still fired.
    expect(fixture.api.update).toHaveBeenCalled();
  });

  it('warns when a row collides with a macOS standard role accelerator', () => {
    // Given: the user has bound New Tab to the standard Copy accelerator.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shortcuts: {
          ...DEFAULT_APP_SETTINGS.shortcuts,
          keybindings: {
            ...DEFAULT_APP_SETTINGS.shortcuts.keybindings,
            'workspace.newTab': 'Command+C',
          },
        },
      },
    });
    render(<ShortcutsSection />);

    // Then: the row warns that the accelerator is reserved by a macOS role.
    const newTabRow = screen.getByLabelText('New Tab keybinding').closest('.grid');
    expect(newTabRow).not.toBeNull();
    expect(within(newTabRow as HTMLElement).getByRole('alert').textContent).toMatch(
      /reserved by a macOS menu role/i,
    );
  });

  it('warns when a row collides with the global Activate Evermore hotkey', () => {
    // Given: a workspace action shares the activate-app accelerator.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shortcuts: {
          activateAppHotkey: 'Command+Shift+,',
          keybindings: {
            ...DEFAULT_APP_SETTINGS.shortcuts.keybindings,
            'workspace.newTab': 'Command+Shift+,',
          },
        },
      },
    });
    render(<ShortcutsSection />);

    // Then: the row warns that it matches the global hotkey.
    const newTabRow = screen.getByLabelText('New Tab keybinding').closest('.grid');
    expect(newTabRow).not.toBeNull();
    expect(within(newTabRow as HTMLElement).getByRole('alert').textContent).toMatch(
      /global Activate Evermore hotkey/i,
    );
  });

  it('does not warn for rows whose accelerator matches their own default', () => {
    // Given: defaults — Cmd+T is the default for workspace.newTab and is reserved by the app menu
    // template only because of this action; treating that as a self-conflict would warn on every
    // row out of the box.
    fixture = createSettingsApiFixture();
    render(<ShortcutsSection />);

    // Then: no row currently surfaces an alert.
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
