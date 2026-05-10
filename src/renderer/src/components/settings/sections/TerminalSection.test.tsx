import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import type { Api, SettingsUpdate } from '../../../../../shared/api-types';
import type { AppSettings } from '../../../../../shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';
import { TerminalSection } from './TerminalSection';

function mergeSettings(current: AppSettings, patch: SettingsUpdate): AppSettings {
  return {
    terminal: patch.terminal ? { ...current.terminal, ...patch.terminal } : current.terminal,
    paneInfo: patch.paneInfo ? { ...current.paneInfo, ...patch.paneInfo } : current.paneInfo,
    shortcuts: patch.shortcuts ? { ...current.shortcuts, ...patch.shortcuts } : current.shortcuts,
    app: patch.app ? { ...current.app, ...patch.app } : current.app,
  };
}

describe('TerminalSection', () => {
  let currentSettings: AppSettings;
  let settingsApi: Api['settings'];

  beforeEach(() => {
    vi.useFakeTimers();
    currentSettings = structuredClone(DEFAULT_APP_SETTINGS);
    settingsApi = {
      get: vi.fn(() => Promise.resolve(structuredClone(currentSettings))),
      update: vi.fn((patch) => {
        currentSettings = mergeSettings(currentSettings, patch);
        return Promise.resolve(structuredClone(currentSettings));
      }),
      reset: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
      reload: vi.fn(() => Promise.resolve(structuredClone(currentSettings))),
      openFile: vi.fn(() => Promise.resolve()),
      getFilePath: vi.fn(() => Promise.resolve('/tmp/evermore/settings.json')),
    };

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        settings: settingsApi,
      } as unknown as Window['api'],
    });
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({
      settings: null,
      isLoading: false,
      error: null,
    });
    Reflect.deleteProperty(window, 'api');
  });

  it('updates cursor style through the settings store', async () => {
    // Given: the terminal settings section is visible.
    render(<TerminalSection />);

    // When: the user chooses underline cursor style.
    fireEvent.click(screen.getByRole('radio', { name: /underline/i }));

    // Then: the UI updates optimistically and the debounced settings patch is persisted.
    expect(screen.getByRole('radio', { name: /underline/i })).toBeChecked();
    await vi.advanceTimersByTimeAsync(350);
    expect(settingsApi.update).toHaveBeenCalledWith({
      terminal: { cursorStyle: 'underline' },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
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
    expect(settingsApi.update).toHaveBeenCalledWith({
      terminal: { copyOnSelect: false },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
    });
  });
});
