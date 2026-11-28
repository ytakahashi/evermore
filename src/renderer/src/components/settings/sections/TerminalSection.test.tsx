import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TerminalSection } from './TerminalSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('TerminalSection', () => {
  let fixture: SettingsApiFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createSettingsApiFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.teardown();
  });

  it('updates cursor style through the settings store', async () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);

    // When: the user chooses underline cursor style.
    fireEvent.click(screen.getByRole('radio', { name: /underline/i }));

    // Then: the UI updates optimistically and the debounced settings patch is persisted.
    expect(screen.getByRole('radio', { name: /underline/i })).toBeChecked();
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: { cursorStyle: 'underline' },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
    });
  });

  it('toggles terminal behavior flags', async () => {
    // Given: the terminal settings section is visible with defaults enabled.
    render(<TerminalSection />);

    // When: the user disables copy-on-select.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Copy on select' }));

    // Then: the state is reflected immediately and persisted after the debounce.
    expect(useSettingsStore.getState().settings?.terminal.copyOnSelect).toBe(false);
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: { copyOnSelect: false },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
    });
  });

  it('toggles close-pane-on-exit and persists the change', async () => {
    // Given: the terminal settings section is visible with the close-pane-on-exit default of true.
    render(<TerminalSection />);
    expect(useSettingsStore.getState().settings?.terminal.closePaneOnExit).toBe(true);

    // When: the user disables close-pane-on-exit.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Close pane on exit' }));

    // Then: the new value is reflected in the store and persisted after the debounce.
    expect(useSettingsStore.getState().settings?.terminal.closePaneOnExit).toBe(false);
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: { closePaneOnExit: false },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
    });
  });

  it('updates font settings through the settings store', async () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);

    // When: the user changes font family, size, and weight.
    fireEvent.change(screen.getByLabelText(/font family/i), {
      target: { value: 'Fira Code' },
    });
    fireEvent.change(screen.getByLabelText(/font size/i), {
      target: { value: '16' },
    });
    fireEvent.change(screen.getByLabelText(/^font weight$/i), {
      target: { value: '300' },
    });
    fireEvent.change(screen.getByLabelText(/bold font weight/i), {
      target: { value: '600' },
    });

    // Then: the UI reflects the changes and they are persisted after debounce.
    expect(useSettingsStore.getState().settings?.terminal.fontFamily).toBe('Fira Code');
    expect(useSettingsStore.getState().settings?.terminal.fontSize).toBe(16);
    expect(useSettingsStore.getState().settings?.terminal.fontWeight).toBe('300');
    expect(useSettingsStore.getState().settings?.terminal.fontWeightBold).toBe('600');

    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: {
        fontFamily: 'Fira Code',
        fontSize: 16,
        fontWeight: '300',
        fontWeightBold: '600',
      },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
    });
  });

  it('shows every persisted font weight value as a selectable option', () => {
    // Given: settings were hand-edited to use numeric font weights not covered by keyword labels.
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        terminal: {
          ...DEFAULT_APP_SETTINGS.terminal,
          fontWeight: '700',
          fontWeightBold: '900',
        },
      },
    });

    // When: the terminal settings section is visible.
    render(<TerminalSection />);

    // Then: the select controls can represent the persisted values.
    expect(screen.getByLabelText(/^font weight$/i)).toHaveValue('700');
    expect(screen.getByLabelText(/bold font weight/i)).toHaveValue('900');
  });

  it('prevents saving out-of-range font sizes', async () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);
    const initialFontSize = DEFAULT_APP_SETTINGS.terminal.fontSize;

    // When: the user enters a size below the minimum.
    fireEvent.change(screen.getByLabelText(/font size/i), {
      target: { value: '2' },
    });

    // Then: the invalid value is rejected and not sent to the store.
    expect(useSettingsStore.getState().settings?.terminal.fontSize).toBe(initialFontSize);

    // When: the user enters a size above the maximum.
    fireEvent.change(screen.getByLabelText(/font size/i), {
      target: { value: '200' },
    });

    // Then: the invalid value is rejected.
    expect(useSettingsStore.getState().settings?.terminal.fontSize).toBe(initialFontSize);
  });
  it('saves a typed scrollback value only when the input is committed', async () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);
    const input = screen.getByLabelText(/scrollback lines/i);

    // When: the user types a new value that passes through shorter in-range prefixes.
    fireEvent.change(input, { target: { value: '2000' } });
    fireEvent.change(input, { target: { value: '20000' } });

    // Then: the draft is shown but nothing is saved yet.
    expect(input).toHaveValue(20_000);
    expect(useSettingsStore.getState().settings?.terminal.scrollback).toBe(
      DEFAULT_APP_SETTINGS.terminal.scrollback,
    );

    // When: the user leaves the input.
    fireEvent.blur(input);

    // Then: only the final value is saved and persisted.
    expect(useSettingsStore.getState().settings?.terminal.scrollback).toBe(20_000);
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledOnce();
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: { scrollback: 20_000 } }),
    );
  });

  it('saves a scrollback value when Enter is pressed', () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);
    const input = screen.getByLabelText(/scrollback lines/i);

    // When: the user types a value and presses Enter.
    fireEvent.change(input, { target: { value: '10000' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Then: the value is saved.
    expect(useSettingsStore.getState().settings?.terminal.scrollback).toBe(10_000);
  });

  it('discards a scrollback draft on Escape without letting Escape bubble', () => {
    // Given: the user has typed an unsaved scrollback value.
    render(<TerminalSection />);
    const input = screen.getByLabelText(/scrollback lines/i);
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    fireEvent.change(input, { target: { value: '10000' } });

    // When: the user presses Escape and then leaves the input.
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    // Then: the saved value is shown again, nothing is saved, and the view-level Esc handler is
    // not reached.
    expect(input).toHaveValue(DEFAULT_APP_SETTINGS.terminal.scrollback);
    expect(useSettingsStore.getState().settings?.terminal.scrollback).toBe(
      DEFAULT_APP_SETTINGS.terminal.scrollback,
    );
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKeyDown);
  });

  it('lets Escape bubble when there is no scrollback draft', () => {
    // Given: the scrollback input has no unsaved draft.
    render(<TerminalSection />);
    const input = screen.getByLabelText(/scrollback lines/i);
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);

    // When: the user presses Escape.
    fireEvent.keyDown(input, { key: 'Escape' });

    // Then: Escape reaches the view-level handler so it can dismiss the settings view.
    expect(onWindowKeyDown).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', onWindowKeyDown);
  });

  it.each([['500'], ['60000'], ['1500.5'], ['']])(
    'reverts an invalid scrollback draft (%s) on blur without saving it',
    (value) => {
      // Given: the terminal settings section is visible.
      render(<TerminalSection />);
      const input = screen.getByLabelText(/scrollback lines/i);
      const initialScrollback = DEFAULT_APP_SETTINGS.terminal.scrollback;

      // When: the user enters an invalid value and leaves the input.
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);

      // Then: the saved value is kept and shown again.
      expect(useSettingsStore.getState().settings?.terminal.scrollback).toBe(initialScrollback);
      expect(input).toHaveValue(initialScrollback);
    },
  );
});
