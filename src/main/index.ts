import { app, dialog, shell, BrowserWindow, type MessageBoxOptions } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronApp, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { DEFAULT_APP_SETTINGS } from '../shared/settings-defaults';
import { registerIpcHandlers, type RegisteredIpcHandlers } from './ipc/register';
import { QuitConfirmationController } from './quit-confirmation';
import { SettingsStore } from './settings/settings-store';
import { attachWindowShortcuts } from './window-shortcuts';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
let mainWindow: BrowserWindow | null = null;
let ipcRuntime: RegisteredIpcHandlers | null = null;
let settingsStore: SettingsStore | null = null;
let quitConfirmationController: QuitConfirmationController | null = null;

function cleanupRuntime(): void {
  ipcRuntime?.dispose();
  ipcRuntime = null;
  settingsStore = null;
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(_dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = window;

  window.on('ready-to-show', () => {
    window.show();
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    window.loadFile(join(_dirname, '../renderer/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('net.ytakahashi.evermore');

  // Suppress only Cmd-modified renderer shortcuts (reload / zoom / production DevTools) so that
  // Ctrl-modified key combinations such as Ctrl+R reach xterm for shell reverse-i-search. The
  // previous `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils` OR-blocked
  // `KeyR && (input.control || input.meta)` and killed Ctrl+R as a side-effect.
  app.on('browser-window-created', (_, window) => {
    attachWindowShortcuts(window);
  });

  settingsStore = new SettingsStore();
  ipcRuntime = registerIpcHandlers({
    getWindow: () => mainWindow,
    settingsStore,
  });
  quitConfirmationController = new QuitConfirmationController({
    cleanup: cleanupRuntime,
    getSettings: () => settingsStore?.get() ?? DEFAULT_APP_SETTINGS,
    getWindow: () => mainWindow,
    // Fall back to `false` when ipcRuntime is unavailable so the user can still quit; we'd rather
    // skip the confirmation than block shutdown on a missing runtime (mirrors `listPaneInfo`).
    hasActiveTunnelForQuitConfirm: () => ipcRuntime?.hasActiveTunnelForQuitConfirm() ?? false,
    listPaneInfo: () => ipcRuntime?.paneInfoTracker.list() ?? [],
    requestQuit: () => {
      app.quit();
    },
    showMessageBox: (window, options: MessageBoxOptions) => {
      if (window && !window.isDestroyed()) {
        return dialog.showMessageBox(window, options);
      }

      return dialog.showMessageBox(options);
    },
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', (event) => {
  quitConfirmationController?.handleBeforeQuit(event);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
