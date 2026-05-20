import { vi } from 'vitest';
import type { Api, SettingsUpdate } from '../../../../../../shared/api-types';
import { DEFAULT_APP_SETTINGS } from '../../../../../../shared/settings-defaults';
import type { AppSettings } from '../../../../../../shared/types';
import { useSettingsStore } from '../../../../stores/settingsStore';

/**
 * Fake `window.api.settings` plus matching `useSettingsStore` seed for renderer settings-section
 * tests. Centralizes the boilerplate every section test would otherwise repeat (~25 lines).
 */
export interface SettingsApiFixture {
  /**
   * The fake `Api['settings']` already installed on `window.api`. Tests assert on `fixture.api.update`
   * the same way they would assert on a hand-rolled stub.
   */
  api: Api['settings'];
  /**
   * Restores `window.api` and resets `useSettingsStore` to its pre-fixture state.
   *
   * Test files **must** invoke this from `afterEach`. Leaking `window.api` across tests would
   * cause later renders to read the previous fixture's settings; leaking `useSettingsStore` would
   * cause optimistic state from earlier tests to bleed into later ones.
   */
  teardown: () => void;
}

export interface CreateSettingsApiFixtureOptions {
  /** Initial persisted snapshot. Defaults to {@link DEFAULT_APP_SETTINGS}. */
  initial?: AppSettings;
  /**
   * Override how the fake main applies a patch. Use to simulate main-side clamping (e.g. a
   * rejected hotkey accelerator) where the returned settings differ from the requested patch.
   * Defaults to a section-aware shallow merge.
   */
  updateImpl?: (current: AppSettings, patch: SettingsUpdate) => AppSettings;
}

function defaultMerge(current: AppSettings, patch: SettingsUpdate): AppSettings {
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

/**
 * Installs a fresh fake `window.api.settings` and seeds `useSettingsStore` with the initial
 * settings snapshot.
 *
 * The fake retains a mutable `currentSettings` ref so successive `update` / `reset` calls observe
 * each other, mirroring the real main-process `SettingsStore`. `reset` updates that ref too so a
 * later `update` merges into defaults instead of stale state.
 */
export function createSettingsApiFixture(
  options: CreateSettingsApiFixtureOptions = {},
): SettingsApiFixture {
  const initial = options.initial ?? DEFAULT_APP_SETTINGS;
  const update = options.updateImpl ?? defaultMerge;
  let currentSettings = structuredClone(initial);

  const api: Api['settings'] = {
    get: vi.fn(() => Promise.resolve(structuredClone(currentSettings))),
    update: vi.fn((patch) => {
      currentSettings = update(currentSettings, patch);
      return Promise.resolve(structuredClone(currentSettings));
    }),
    reset: vi.fn(() => {
      currentSettings = structuredClone(DEFAULT_APP_SETTINGS);
      return Promise.resolve(structuredClone(currentSettings));
    }),
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

  return {
    api,
    teardown(): void {
      Reflect.deleteProperty(window, 'api');
      useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    },
  };
}
