import { ipcMain, shell } from 'electron';
import type { SettingsUpdate } from '../../../shared/api-types';
import { IPC } from '../../../shared/ipc-channels';
import type { AppSettings } from '../../../shared/types';
import { SettingsStore } from '../../settings/settings-store';

interface RegisterSettingsHandlersOptions {
  settingsStore?: SettingsStore;
  applyRuntimeSettings?: (settings: AppSettings) => AppSettings;
  /**
   * Optional override for opening the settings file. Defaults to Electron's `shell.showItemInFolder`,
   * which reveals the file in the OS file manager (Finder on macOS) instead of opening it in an
   * external editor that may not exist on the user's machine.
   */
  openInFileManager?: (filePath: string) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSectionUpdate<TSection>(value: unknown): Partial<TSection> | undefined {
  return isPlainObject(value) ? (value as Partial<TSection>) : undefined;
}

function readSettingsUpdate(payload: unknown): SettingsUpdate {
  const settings = isPlainObject(payload) ? payload.settings : undefined;
  if (!isPlainObject(settings)) {
    return {};
  }

  return {
    terminal: readSectionUpdate<AppSettings['terminal']>(settings.terminal),
    paneInfo: readSectionUpdate<AppSettings['paneInfo']>(settings.paneInfo),
    shortcuts: readSectionUpdate<AppSettings['shortcuts']>(settings.shortcuts),
    app: readSectionUpdate<AppSettings['app']>(settings.app),
    shellIntegration: readSectionUpdate<AppSettings['shellIntegration']>(settings.shellIntegration),
    notifications: readSectionUpdate<AppSettings['notifications']>(settings.notifications),
  };
}

/**
 * Bridges renderer settings get / update / reset / open-file requests to the main-process store.
 *
 * `update` returns the post-write settings so the renderer can detect server-side clamping or
 * fallbacks (for example, a global hotkey accelerator the OS would not let us register may come
 * back unchanged from its previous value).
 */
export function registerSettingsHandlers(
  options: RegisterSettingsHandlersOptions = {},
): () => void {
  const settingsStore = options.settingsStore ?? new SettingsStore();
  const openInFileManager = options.openInFileManager ?? shell.showItemInFolder.bind(shell);

  ipcMain.handle(IPC.SETTINGS_GET, () => settingsStore.get());
  const applyRuntimeSettings = options.applyRuntimeSettings ?? ((settings) => settings);

  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, payload: unknown) => {
    return applyRuntimeSettings(settingsStore.update(readSettingsUpdate(payload)));
  });
  ipcMain.handle(IPC.SETTINGS_RESET, () => applyRuntimeSettings(settingsStore.reset()));
  ipcMain.handle(IPC.SETTINGS_RELOAD, () => applyRuntimeSettings(settingsStore.reload()));
  ipcMain.handle(IPC.SETTINGS_GET_FILE_PATH, () => settingsStore.getFilePath());
  ipcMain.handle(IPC.SETTINGS_OPEN_FILE, () => {
    openInFileManager(settingsStore.getFilePath());
  });

  return () => {
    ipcMain.removeHandler(IPC.SETTINGS_GET);
    ipcMain.removeHandler(IPC.SETTINGS_UPDATE);
    ipcMain.removeHandler(IPC.SETTINGS_RESET);
    ipcMain.removeHandler(IPC.SETTINGS_RELOAD);
    ipcMain.removeHandler(IPC.SETTINGS_GET_FILE_PATH);
    ipcMain.removeHandler(IPC.SETTINGS_OPEN_FILE);
  };
}
