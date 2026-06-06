import { app, dialog, BrowserWindow, type MessageBoxOptions } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronApp, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { IPC } from '../shared/ipc-channels';
import { DEFAULT_APP_SETTINGS } from '../shared/settings-defaults';
import { registerIpcHandlers, type RegisteredIpcHandlers } from './ipc/register';
import { createLogger, resolveLogLevel, type Logger, type LogTransport } from './logging/logger';
import { ConsoleTransport } from './logging/transports/console';
import { QuitConfirmationController } from './quit-confirmation';
import { SettingsStore } from './settings/settings-store';
import {
  attachWebContentsNavigationGuard,
  openSafeExternalUrl,
  registerSecurityHandlers,
} from './web-contents-security';
import { createMainWindowOptions } from './window-options';
import { attachWindowShortcuts } from './window-shortcuts';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
let mainWindow: BrowserWindow | null = null;
let ipcRuntime: RegisteredIpcHandlers | null = null;
let settingsStore: SettingsStore | null = null;
let quitConfirmationController: QuitConfirmationController | null = null;
let rootLogTransport: LogTransport | null = null;

function cleanupRuntime(): void {
  // Order matters: dispose managers and IPC handlers first so any final log writes during their
  // dispose() chain still reach the transport. Only after the runtime is gone do we tear the
  // transport down. Phase 1 ConsoleTransport has no resources to release; the contract is
  // established here so a Phase 2 file transport can plug in without changing call sites.
  ipcRuntime?.dispose();
  ipcRuntime = null;
  settingsStore = null;
  rootLogTransport?.dispose?.();
  rootLogTransport = null;
}

function createWindow(): void {
  const devRendererUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined;
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: join(_dirname, '../preload/index.cjs'),
      isDev: is.dev,
      iconPath: icon,
    }),
  );
  mainWindow = window;

  window.on('ready-to-show', () => {
    window.show();
  });

  window.on('enter-full-screen', () => {
    window.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, true);
  });

  window.on('leave-full-screen', () => {
    window.webContents.send(IPC.WINDOW_FULLSCREEN_CHANGED, false);
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  window.webContents.setWindowOpenHandler((details) => {
    openSafeExternalUrl(details.url);
    return { action: 'deny' };
  });
  attachWebContentsNavigationGuard(window.webContents, {
    allowedInternalOrigins: devRendererUrl ? [devRendererUrl] : [],
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (devRendererUrl) {
    window.loadURL(devRendererUrl);
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

  registerSecurityHandlers();

  // Suppress only Cmd-modified renderer shortcuts (reload / zoom / production DevTools) so that
  // Ctrl-modified key combinations such as Ctrl+R reach xterm for shell reverse-i-search. The
  // previous `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils` OR-blocked
  // `KeyR && (input.control || input.meta)` and killed Ctrl+R as a side-effect.
  app.on('browser-window-created', (_, window) => {
    attachWindowShortcuts(window);
  });

  const consoleTransport = new ConsoleTransport();
  rootLogTransport = consoleTransport;
  // LOG_LEVEL is forwarded from the launching shell, so it is only available when the process
  // inherits the shell environment: `pnpm dev` (the dev path), running the packaged binary
  // directly (`/Applications/Evermore.app/Contents/MacOS/Evermore`), or pre-registering with
  // `launchctl setenv LOG_LEVEL …`. Finder clicks and `open -a Evermore` go through launchd and
  // do not inherit shell env, so the fallback in `resolveLogLevel` (debug in dev, info in prod)
  // applies there.
  const rootLogger: Logger = createLogger({
    level: resolveLogLevel(process.env['LOG_LEVEL'], is.dev),
    transport: consoleTransport,
    scope: 'evermore',
  });
  settingsStore = new SettingsStore({ logger: rootLogger.child('settings') });
  ipcRuntime = registerIpcHandlers({
    getWindow: () => mainWindow,
    settingsStore,
    isDev: is.dev,
    logger: rootLogger,
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
