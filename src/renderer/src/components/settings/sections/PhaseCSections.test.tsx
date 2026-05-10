import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, SettingsUpdate } from '../../../../../shared/api-types';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import type { AppSettings } from '../../../../../shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ApplicationSection } from './ApplicationSection';
import { PaneInfoSection } from './PaneInfoSection';
import { ShortcutsSection } from './ShortcutsSection';

function mergeSettings(current: AppSettings, patch: SettingsUpdate): AppSettings {
  return {
    terminal: patch.terminal ? { ...current.terminal, ...patch.terminal } : current.terminal,
    paneInfo: patch.paneInfo ? { ...current.paneInfo, ...patch.paneInfo } : current.paneInfo,
    shortcuts: patch.shortcuts ? { ...current.shortcuts, ...patch.shortcuts } : current.shortcuts,
    app: patch.app ? { ...current.app, ...patch.app } : current.app,
  };
}

function installSettingsApi(
  updateImpl?: (current: AppSettings, patch: SettingsUpdate) => AppSettings,
): Api['settings'] {
  let currentSettings = structuredClone(DEFAULT_APP_SETTINGS);
  const api: Api['settings'] = {
    get: vi.fn(() => Promise.resolve(structuredClone(currentSettings))),
    update: vi.fn((patch) => {
      currentSettings = updateImpl
        ? updateImpl(currentSettings, patch)
        : mergeSettings(currentSettings, patch);
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
      settings: api,
    } as unknown as Window['api'],
  });
  useSettingsStore.setState({
    settings: structuredClone(DEFAULT_APP_SETTINGS),
    isLoading: false,
    error: null,
  });
  return api;
}

describe('Phase C settings sections', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
  });

  it('updates pane info polling interval', async () => {
    // Given: the Pane info section is visible.
    const api = installSettingsApi();
    render(<PaneInfoSection />);

    // When: the user disables polling by entering 0.
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    await vi.advanceTimersByTimeAsync(350);

    // Then: the setting patch preserves the disable value.
    expect(api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: { pollIntervalMs: 0 },
      shortcuts: undefined,
      app: undefined,
    });
  });

  it('updates Cmd+Q confirmation behavior', async () => {
    // Given: the Application section is visible.
    const api = installSettingsApi();
    render(<ApplicationSection />);

    // When: the user selects Always.
    fireEvent.click(screen.getByRole('radio', { name: /always/i }));
    await vi.advanceTimersByTimeAsync(350);

    // Then: the application setting is persisted.
    expect(api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: undefined,
      shortcuts: undefined,
      app: { quitConfirm: 'always' },
    });
  });

  it('shows an inline error when the activate hotkey is rejected by main', async () => {
    // Given: main rejects the requested hotkey and returns the previous value.
    installSettingsApi((current) => current);
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
    const api = installSettingsApi();
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
    expect(api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: undefined,
      shortcuts: { activateAppHotkey: 'Command+Option+Shift+,' },
      app: undefined,
    });
  });
});
