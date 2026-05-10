import { ipcMain, shell } from 'electron';
import type { SettingsUpdate } from '../../../shared/api-types';
import { IPC } from '../../../shared/ipc-channels';
import { SettingsStore } from '../../settings/settings-store';

interface RegisterSettingsHandlersOptions {
  settingsStore?: SettingsStore;
  /**
   * Optional override for opening the settings file. Defaults to Electron's `shell.showItemInFolder`,
   * which reveals the file in the OS file manager (Finder on macOS) instead of opening it in an
   * external editor that may not exist on the user's machine.
   */
  openInFileManager?: (filePath: string) => void;
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
  ipcMain.handle(IPC.SETTINGS_UPDATE, (_event, payload: { settings: SettingsUpdate }) => {
    return settingsStore.update(payload.settings ?? {});
  });
  ipcMain.handle(IPC.SETTINGS_RESET, () => settingsStore.reset());
  ipcMain.handle(IPC.SETTINGS_GET_FILE_PATH, () => settingsStore.getFilePath());
  ipcMain.handle(IPC.SETTINGS_OPEN_FILE, () => {
    openInFileManager(settingsStore.getFilePath());
  });

  return () => {
    ipcMain.removeHandler(IPC.SETTINGS_GET);
    ipcMain.removeHandler(IPC.SETTINGS_UPDATE);
    ipcMain.removeHandler(IPC.SETTINGS_RESET);
    ipcMain.removeHandler(IPC.SETTINGS_GET_FILE_PATH);
    ipcMain.removeHandler(IPC.SETTINGS_OPEN_FILE);
  };
}
