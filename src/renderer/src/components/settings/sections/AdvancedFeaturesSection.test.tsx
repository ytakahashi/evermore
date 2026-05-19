import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api, SettingsUpdate } from '../../../../../shared/api-types';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import type { AppSettings } from '../../../../../shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';
import { AdvancedFeaturesSection } from './AdvancedFeaturesSection';

function mergeSettings(current: AppSettings, patch: SettingsUpdate): AppSettings {
  return {
    terminal: patch.terminal ? { ...current.terminal, ...patch.terminal } : current.terminal,
    paneInfo: patch.paneInfo ? { ...current.paneInfo, ...patch.paneInfo } : current.paneInfo,
    shortcuts: patch.shortcuts ? { ...current.shortcuts, ...patch.shortcuts } : current.shortcuts,
    app: patch.app ? { ...current.app, ...patch.app } : current.app,
    shellIntegration: patch.shellIntegration
      ? { ...current.shellIntegration, ...patch.shellIntegration }
      : current.shellIntegration,
  };
}

function installSettingsApi(initial: AppSettings = structuredClone(DEFAULT_APP_SETTINGS)): {
  api: Api['settings'];
} {
  let currentSettings = structuredClone(initial);
  const api: Api['settings'] = {
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
    value: { settings: api } as unknown as Window['api'],
  });
  useSettingsStore.setState({
    settings: structuredClone(initial),
    isLoading: false,
    error: null,
  });
  return { api };
}

describe('AdvancedFeaturesSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
  });

  it('reflects the persisted auto-inject value as the checked state', () => {
    // Given: the user has disabled auto-injection.
    installSettingsApi({
      ...DEFAULT_APP_SETTINGS,
      shellIntegration: { autoInject: false },
    });

    // When: the section is rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the toggle reads back the persisted disabled state.
    const toggle = screen.getByRole('checkbox', { name: 'Automatic shell integration (zsh)' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('persists a toggle change through the settings store', async () => {
    // Given: the section is visible with auto-inject ON (default).
    const { api } = installSettingsApi();
    render(<AdvancedFeaturesSection />);

    // When: the user disables auto-injection.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic shell integration (zsh)' }));

    // Then: the optimistic state flips immediately.
    expect(useSettingsStore.getState().settings?.shellIntegration.autoInject).toBe(false);

    // And: after the debounce, the patch reaches the main process with only the
    // shellIntegration section set.
    await vi.advanceTimersByTimeAsync(350);
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ shellIntegration: { autoInject: false } }),
    );
  });

  it('explains that the toggle only affects new panes', () => {
    // Given: the section is rendered with defaults.
    installSettingsApi();

    // When: the description is rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the copy makes it clear existing PTYs are not affected (a load-bearing detail —
    // the injector deliberately does not retroactively change running shells).
    expect(screen.getByText(/Takes effect for new panes only/i)).toBeInTheDocument();
  });

  it('notes that other shells and remote shells are out of scope', () => {
    // Given: the section is rendered with defaults.
    installSettingsApi();

    // When: rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the copy explicitly excludes bash / fish and remote shells so users do not expect
    // those panes to gain shell integration from this toggle.
    expect(screen.getByText(/Other shells \(bash, fish\)/i)).toBeInTheDocument();
    expect(screen.getByText(/remote shells are not auto-injected/i)).toBeInTheDocument();
  });
});
