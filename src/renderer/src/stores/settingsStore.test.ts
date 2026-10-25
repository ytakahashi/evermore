import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings-defaults';
import type { Api } from '../../../shared/api-types';
import type { AppSettings } from '../../../shared/types';
import { createSettingsStore } from './settingsStore';

function makeSettingsApi(initial: AppSettings = structuredClone(DEFAULT_APP_SETTINGS)): {
  api: Api['settings'];
  state: { current: AppSettings };
} {
  // Hold a mutable copy so successive `update` calls observe each other, mirroring how the real
  // main-process SettingsStore behaves.
  const state = { current: structuredClone(initial) };
  const api: Api['settings'] = {
    get: vi.fn(() => Promise.resolve(structuredClone(state.current))),
    update: vi.fn((patch) => {
      state.current = {
        terminal: patch.terminal
          ? { ...state.current.terminal, ...patch.terminal }
          : state.current.terminal,
        paneInfo: patch.paneInfo
          ? { ...state.current.paneInfo, ...patch.paneInfo }
          : state.current.paneInfo,
        shortcuts: patch.shortcuts
          ? { ...state.current.shortcuts, ...patch.shortcuts }
          : state.current.shortcuts,
        app: patch.app ? { ...state.current.app, ...patch.app } : state.current.app,
        shellIntegration: patch.shellIntegration
          ? { ...state.current.shellIntegration, ...patch.shellIntegration }
          : state.current.shellIntegration,
        notifications: patch.notifications
          ? { ...state.current.notifications, ...patch.notifications }
          : state.current.notifications,
        agents: patch.agents ? { ...state.current.agents, ...patch.agents } : state.current.agents,
        projects: patch.projects
          ? { ...state.current.projects, ...patch.projects }
          : state.current.projects,
      };
      return Promise.resolve(structuredClone(state.current));
    }),
    reset: vi.fn(() => {
      state.current = structuredClone(DEFAULT_APP_SETTINGS);
      return Promise.resolve(structuredClone(state.current));
    }),
    reload: vi.fn(() => Promise.resolve(structuredClone(state.current))),
    openFile: vi.fn(() => Promise.resolve()),
    getFilePath: vi.fn(() => Promise.resolve('/tmp/evermore/settings.json')),
  };
  return { api, state };
}

describe('createSettingsStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads settings from the api on demand', async () => {
    // Given: an isolated store backed by a stub api.
    const { api } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api });

    // When: the bridge calls loadSettings.
    await useStore.getState().loadSettings();

    // Then: state is populated and the api was hit exactly once.
    expect(api.get).toHaveBeenCalledOnce();
    expect(useStore.getState().settings).toEqual(DEFAULT_APP_SETTINGS);
    expect(useStore.getState().isLoading).toBe(false);
    expect(useStore.getState().error).toBeNull();
  });

  it('debounces writes and applies the merged patch optimistically', async () => {
    // Given: a store loaded from defaults with a deterministic 50ms debounce.
    const { api } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api, debounceMs: 50 });
    await useStore.getState().loadSettings();

    // When: the user toggles two terminal preferences in quick succession.
    const flushA = useStore.getState().updateSettings({ terminal: { copyOnSelect: false } });
    const flushB = useStore.getState().updateSettings({ terminal: { macOptionIsMeta: false } });

    // Then: state already reflects both changes (optimistic) before the debounce has fired.
    expect(useStore.getState().settings?.terminal.copyOnSelect).toBe(false);
    expect(useStore.getState().settings?.terminal.macOptionIsMeta).toBe(false);
    expect(api.update).not.toHaveBeenCalled();

    // When: the debounce window elapses.
    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([flushA, flushB]);

    // Then: a single combined update is sent to the main process.
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledWith({
      terminal: { copyOnSelect: false, macOptionIsMeta: false },
      paneInfo: undefined,
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
      notifications: undefined,
    });
  });

  it('applies a shellIntegration patch optimistically and flushes it through the api', async () => {
    // Given: a loaded store with auto-injection defaulting to ON.
    const { api } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api, debounceMs: 20 });
    await useStore.getState().loadSettings();
    expect(useStore.getState().settings?.shellIntegration.autoInject).toBe(true);

    // When: the user toggles auto-injection off.
    const flush = useStore.getState().updateSettings({ shellIntegration: { autoInject: false } });

    // Then: local state reflects the change immediately, before the debounce fires.
    expect(useStore.getState().settings?.shellIntegration.autoInject).toBe(false);
    expect(api.update).not.toHaveBeenCalled();

    // When: the debounce elapses.
    await vi.advanceTimersByTimeAsync(40);
    const confirmed = await flush;

    // Then: the api receives the shellIntegration section and the post-write state confirms it.
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ shellIntegration: { autoInject: false } }),
    );
    expect(confirmed?.shellIntegration.autoInject).toBe(false);
  });

  it('replaces the projects directory list as a whole when patches are coalesced', async () => {
    // Given: a loaded store with no registered directories.
    const { api } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api, debounceMs: 20 });
    await useStore.getState().loadSettings();

    // When: two list edits land within one debounce window.
    void useStore.getState().updateSettings({ projects: { directories: ['/work/a', '/work/b'] } });
    const flush = useStore.getState().updateSettings({ projects: { directories: ['/work/b'] } });
    await vi.advanceTimersByTimeAsync(40);
    await flush;

    // Then: the latest list wins instead of being merged element-wise with the earlier one.
    expect(useStore.getState().settings?.projects.directories).toEqual(['/work/b']);
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ projects: { directories: ['/work/b'] } }),
    );
  });

  it('coalesces preset arrays while preserving sibling settings', async () => {
    // Given: a loaded isolated store with a short debounce.
    const { api } = makeSettingsApi();
    const store = createSettingsStore({ settingsApi: api, debounceMs: 20 });
    await store.getState().loadSettings();
    const presets = [{ id: 'custom', label: '', command: 'agent --flag' }];

    // When: presets are replaced twice alongside another settings section.
    void store.getState().updateSettings({ agents: { presets } });
    expect(store.getState().settings?.agents.presets).toEqual(presets);
    void store.getState().updateSettings({ projects: { directories: ['/work'] } });
    const flushed = store.getState().updateSettings({ agents: { presets: [] } });
    await vi.advanceTimersByTimeAsync(30);
    await flushed;

    // Then: the final array replaces the earlier one and the sibling update survives.
    expect(api.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        agents: { presets: [] },
        projects: { directories: ['/work'] },
      }),
    );
    expect(store.getState().settings?.agents.presets).toEqual([]);
    expect(store.getState().settings?.projects.directories).toEqual(['/work']);
  });

  it('reconciles local state with the post-write settings returned by main', async () => {
    // Given: a stub api whose update unilaterally clamps a value, simulating the kind of main-side
    // fallback that a future hotkey-collision feature will surface through this same return path.
    const { api } = makeSettingsApi();
    const customApi: Api['settings'] = {
      ...api,
      update: vi.fn(() =>
        Promise.resolve({
          ...DEFAULT_APP_SETTINGS,
          paneInfo: { pollIntervalMs: 9999 },
        }),
      ),
    };
    const useStore = createSettingsStore({ settingsApi: customApi, debounceMs: 10 });
    await useStore.getState().loadSettings();

    // When: the renderer requests a different value.
    const flush = useStore.getState().updateSettings({ paneInfo: { pollIntervalMs: 100 } });
    await vi.advanceTimersByTimeAsync(20);
    const confirmed = await flush;

    // Then: local state ends up reflecting the main-confirmed value, not the requested one.
    expect(confirmed?.paneInfo.pollIntervalMs).toBe(9999);
    expect(useStore.getState().settings?.paneInfo.pollIntervalMs).toBe(9999);
  });

  it('reset cancels any pending optimistic write so it cannot land afterwards', async () => {
    // Given: a store with a queued debounced write.
    const { api } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api, debounceMs: 50 });
    await useStore.getState().loadSettings();
    const pendingFlush = useStore.getState().updateSettings({
      terminal: { copyOnSelect: false },
    });

    // When: the user resets to defaults before the debounce flushes.
    await useStore.getState().resetSettings();

    // Then: the pending flush resolves to the post-reset settings, no extra update fires.
    const resolved = await pendingFlush;
    expect(resolved).toEqual(DEFAULT_APP_SETTINGS);
    expect(api.update).not.toHaveBeenCalled();
    expect(api.reset).toHaveBeenCalledOnce();
  });

  it('reload cancels pending optimistic writes and uses the disk-confirmed settings', async () => {
    // Given: a loaded store has a pending debounced write, but disk now contains a different value.
    const { api, state } = makeSettingsApi();
    const useStore = createSettingsStore({ settingsApi: api, debounceMs: 50 });
    await useStore.getState().loadSettings();
    const pendingFlush = useStore.getState().updateSettings({
      terminal: { copyOnSelect: false },
    });
    state.current = {
      ...state.current,
      app: { ...state.current.app, quitConfirm: 'never' },
    };

    // When: the user reloads from disk before the debounce flushes.
    await useStore.getState().reloadSettings();

    // Then: the pending flush resolves to the reloaded settings and no stale update lands.
    const resolved = await pendingFlush;
    expect(resolved?.app.quitConfirm).toBe('never');
    expect(api.update).not.toHaveBeenCalled();
    expect(api.reload).toHaveBeenCalledOnce();
    expect(useStore.getState().settings?.app.quitConfirm).toBe('never');
  });

  it('records a load error message on failure without throwing', async () => {
    // Given: an api that fails to load.
    const failingApi: Api['settings'] = {
      get: vi.fn(() => Promise.reject(new Error('disk on fire'))),
      update: vi.fn(),
      reset: vi.fn(),
      reload: vi.fn(),
      openFile: vi.fn(),
      getFilePath: vi.fn(),
    };
    const useStore = createSettingsStore({ settingsApi: failingApi });

    // When: the bridge attempts to load.
    await useStore.getState().loadSettings();

    // Then: state captures the failure for UI display.
    expect(useStore.getState().error).toBe('disk on fire');
    expect(useStore.getState().settings).toBeNull();
    expect(useStore.getState().isLoading).toBe(false);
  });
});
