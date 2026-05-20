import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsSection } from './ShortcutsSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

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
      await vi.advanceTimersByTimeAsync(350);
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
      await vi.advanceTimersByTimeAsync(350);
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
});
