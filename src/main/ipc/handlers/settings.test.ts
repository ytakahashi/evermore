import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings-defaults';
import { IPC } from '../../../shared/ipc-channels';
import type { AppSettings } from '../../../shared/types';
import { SettingsStore } from '../../settings/settings-store';
import type { SettingsStorageAdapter } from '../../settings/types';
import { registerSettingsHandlers } from './settings';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  shell: {
    showItemInFolder: vi.fn(),
  },
}));

class MemorySettingsStorageAdapter implements SettingsStorageAdapter {
  public payload: unknown = {};

  public getSettings(): unknown {
    return this.payload;
  }

  public setSettings(settings: AppSettings): void {
    this.payload = settings;
  }

  public getFilePath(): string {
    return '/tmp/evermore/settings.json';
  }
}

function findHandler(channel: string): ((event: unknown, payload: unknown) => unknown) | undefined {
  return ipcMainMock.handle.mock.calls.find(([registered]) => registered === channel)?.[1];
}

describe('registerSettingsHandlers', () => {
  let storage: MemorySettingsStorageAdapter;
  let settingsStore: SettingsStore;

  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    storage = new MemorySettingsStorageAdapter();
    settingsStore = new SettingsStore({ storage });
  });

  it('returns the current settings on get', async () => {
    // Given: handlers are registered against an empty store.
    registerSettingsHandlers({ settingsStore });

    // When: the renderer invokes settings:get.
    const result = (await findHandler(IPC.SETTINGS_GET)?.({}, {})) as AppSettings;

    // Then: the defaults are returned.
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('persists an update and returns the post-write full settings', async () => {
    // Given: handlers are registered.
    registerSettingsHandlers({ settingsStore });

    // When: the renderer invokes settings:update with a partial patch.
    const result = (await findHandler(IPC.SETTINGS_UPDATE)?.(
      {},
      { settings: { terminal: { cursorStyle: 'block' } } },
    )) as AppSettings;

    // Then: the returned object reflects the patch and the store sees it too.
    expect(result.terminal.cursorStyle).toBe('block');
    expect(settingsStore.get().terminal.cursorStyle).toBe('block');
  });

  it('persists a shellIntegration.autoInject update across the IPC boundary', async () => {
    // Given: handlers are registered with defaults (autoInject defaults to true).
    registerSettingsHandlers({ settingsStore });
    expect(settingsStore.get().shellIntegration.autoInject).toBe(true);

    // When: the renderer invokes settings:update to disable auto-injection.
    const result = (await findHandler(IPC.SETTINGS_UPDATE)?.(
      {},
      { settings: { shellIntegration: { autoInject: false } } },
    )) as AppSettings;

    // Then: the returned value and the underlying store both reflect the disabled state. This
    // catches the regression where the IPC payload whitelist drops the shellIntegration section
    // and silently leaves auto-injection enabled.
    expect(result.shellIntegration.autoInject).toBe(false);
    expect(settingsStore.get().shellIntegration.autoInject).toBe(false);
  });

  it('returns runtime-reconciled settings after update', async () => {
    // Given: runtime settings application falls back to a different hotkey value.
    const applyRuntimeSettings = vi.fn((_settings: AppSettings) => {
      settingsStore.update({ shortcuts: { activateAppHotkey: null } });
      return settingsStore.get();
    });
    registerSettingsHandlers({ settingsStore, applyRuntimeSettings });

    // When: the renderer invokes settings:update with a hotkey that runtime rejects.
    const result = (await findHandler(IPC.SETTINGS_UPDATE)?.(
      {},
      { settings: { shortcuts: { activateAppHotkey: 'CommandOrControl+Shift+Space' } } },
    )) as AppSettings;

    // Then: the handler returns the effective persisted value, not the optimistic request.
    expect(applyRuntimeSettings).toHaveBeenCalled();
    expect(result.shortcuts.activateAppHotkey).toBeNull();
  });

  it('ignores malformed update sections before they reach the store', async () => {
    // Given: handlers are registered and the payload does not match the section-shaped contract.
    registerSettingsHandlers({ settingsStore });

    // When: the renderer invokes settings:update with malformed sections.
    const result = (await findHandler(IPC.SETTINGS_UPDATE)?.(
      {},
      { settings: { terminal: 'not-an-object', paneInfo: { pollIntervalMs: 0 } } },
    )) as AppSettings;

    // Then: the malformed section is ignored, while valid sections still apply.
    expect(result.terminal.cursorStyle).toBe(DEFAULT_APP_SETTINGS.terminal.cursorStyle);
    expect(result.paneInfo.pollIntervalMs).toBe(0);
  });

  it('reset returns to defaults', async () => {
    // Given: settings have drifted from defaults.
    registerSettingsHandlers({ settingsStore });
    settingsStore.update({ app: { quitConfirm: 'never' } });

    // When: the renderer invokes settings:reset.
    const result = (await findHandler(IPC.SETTINGS_RESET)?.({}, {})) as AppSettings;

    // Then: defaults are returned.
    expect(result).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('reload refreshes settings from storage', async () => {
    // Given: storage was edited outside the app after handlers were registered.
    registerSettingsHandlers({ settingsStore });
    storage.payload = {
      terminal: { cursorStyle: 'underline' },
      paneInfo: { pollIntervalMs: 0 },
    };

    // When: the renderer invokes settings:reload.
    const result = (await findHandler(IPC.SETTINGS_RELOAD)?.({}, {})) as AppSettings;

    // Then: the store re-reads storage and normalizes missing fields.
    expect(result.terminal.cursorStyle).toBe('underline');
    expect(result.paneInfo.pollIntervalMs).toBe(0);
    expect(result.terminal.copyOnSelect).toBe(DEFAULT_APP_SETTINGS.terminal.copyOnSelect);
  });

  it('exposes the file path for the About section', async () => {
    // Given: handlers are registered.
    registerSettingsHandlers({ settingsStore });

    // When: the renderer asks for the file path.
    const result = await findHandler(IPC.SETTINGS_GET_FILE_PATH)?.({}, {});

    // Then: the storage adapter path is forwarded.
    expect(result).toBe('/tmp/evermore/settings.json');
  });

  it('open-file delegates to the supplied file manager opener', async () => {
    // Given: a stub opener so we do not invoke real `shell.showItemInFolder`.
    const openInFileManager = vi.fn();
    registerSettingsHandlers({ settingsStore, openInFileManager });

    // When: the renderer invokes settings:open-file.
    await findHandler(IPC.SETTINGS_OPEN_FILE)?.({}, {});

    // Then: the opener is called with the persisted file path.
    expect(openInFileManager).toHaveBeenCalledWith('/tmp/evermore/settings.json');
  });

  it('removes the settings handlers during teardown', () => {
    // Given: handlers are registered.
    const dispose = registerSettingsHandlers({ settingsStore });

    // When: registration is disposed.
    dispose();

    // Then: every channel is removed.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_GET);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_UPDATE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_RESET);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_RELOAD);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_GET_FILE_PATH);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SETTINGS_OPEN_FILE);
  });
});
