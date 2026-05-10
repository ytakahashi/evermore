import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings-defaults';
import { useSettingsStore } from '../stores/settingsStore';
import { useSettingsBridge } from './useSettingsBridge';

function TestBridge(): React.JSX.Element {
  useSettingsBridge();
  return <div>bridge</div>;
}

describe('useSettingsBridge', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        settings: {
          get: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          update: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          reset: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          openFile: vi.fn(() => Promise.resolve()),
          getFilePath: vi.fn(() => Promise.resolve('/tmp/evermore/settings.json')),
        },
      } as unknown as Window['api'],
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
  });

  it('loads persisted settings into the renderer store on mount', async () => {
    // Given: the bridge has not been mounted yet.

    // When: it mounts.
    render(<TestBridge />);

    // Then: the IPC bridge fetches settings and writes them into the store.
    await waitFor(() => expect(window.api.settings.get).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(useSettingsStore.getState().settings).toEqual(DEFAULT_APP_SETTINGS);
    });
  });
});
