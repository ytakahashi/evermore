import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { AppSettings } from '../../shared/types';
import { HotkeyManager } from '../hotkey/hotkey-manager';
import { createSilentLogger, type Logger } from '../logging/logger';
import { createMenuController, type MenuController } from '../menu/menu-controller';
import { createShortcutDispatcher } from '../menu/dispatcher';
import { AiAgentNotifier } from '../notifications/ai-agent-notifier';
import { NotificationService } from '../notifications/notification-service';
import { PaneInfoTracker } from '../pane-info/pane-info-tracker';
import { PtyManager } from '../pty/pty-manager';
import { SettingsStore } from '../settings/settings-store';
import { ShellIntegrationInjector } from '../shell-integration/injector';
import { TunnelManager } from '../tunnels/tunnel-manager';
import { registerPtyHandlers } from './handlers/pty';
import { registerPaneInfoHandlers } from './handlers/pane-info';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSshHandlers } from './handlers/ssh';
import { registerTunnelHandlers } from './handlers/tunnel';
import { registerWindowHandlers } from './handlers/window';
import { registerWorkspaceHandlers } from './handlers/workspace';
import { SshConfigManager } from '../ssh-config/manager';
import { SshHostResolver } from '../ssh-config/host-resolver';

interface RegisterIpcHandlersOptions {
  getWindow: () => BrowserWindow | null;
  settingsStore?: SettingsStore;
  /**
   * Optional override for the shell-integration injector. Production constructs one rooted at
   * `app.getPath('userData')`; tests inject a fake to avoid touching the real userData directory.
   */
  shellIntegrationInjector?: ShellIntegrationInjector;
  /**
   * Whether the application is running in development mode. Threaded through to the menu builder
   * so the DevTools toggle only appears in dev. Defaults to `false` for test convenience; the
   * production caller passes `is.dev` from `@electron-toolkit/utils`.
   */
  isDev?: boolean;
  /**
   * Root logger from the composition root. Optional so tests can omit it; production passes the
   * root logger and per-feature managers receive scoped children created here.
   */
  logger?: Logger;
}

export interface RegisteredIpcHandlers {
  dispose: () => void;
  hasActiveTunnelForQuitConfirm: () => boolean;
  hotkeyManager: HotkeyManager;
  paneInfoTracker: PaneInfoTracker;
}

function isWindowAvailable(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed();
}

/**
 * Registers all main-process IPC handlers and returns a teardown function for app shutdown.
 *
 * The current window is passed as a getter because macOS can destroy and recreate windows while
 * long-lived main-process services, such as PTYs, continue to be owned outside any one window.
 */
export function registerIpcHandlers(options: RegisterIpcHandlersOptions): RegisteredIpcHandlers {
  const logger = options.logger ?? createSilentLogger();
  const settingsStore = options.settingsStore ?? new SettingsStore();
  const sshConfigManager = new SshConfigManager();
  const sshHostResolver = new SshHostResolver();
  const shellIntegrationInjector =
    options.shellIntegrationInjector ??
    new ShellIntegrationInjector({
      userDataDir: app.getPath('userData'),
      initialAutoInject: settingsStore.get().shellIntegration.autoInject,
      logger: logger.child('shell-integration'),
    });
  const hotkeyManager = new HotkeyManager({ getWindow: options.getWindow });
  const notificationService = new NotificationService({
    getWindow: options.getWindow,
    logger: logger.child('notifications'),
  });
  const aiAgentNotifier = new AiAgentNotifier({
    service: notificationService,
    getSettings: () => settingsStore.get(),
  });
  const paneInfoTracker = new PaneInfoTracker({
    pollIntervalMs: settingsStore.get().paneInfo.pollIntervalMs,
    logger: logger.child('pane-info'),
    callbacks: {
      onChanged: ({ info }) => {
        const window = options.getWindow();
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC.PANE_INFO_CHANGED, info);
        }
        // Fan the same observation out to the AI awaiting-input notifier so it can raise a macOS
        // notification on pane attention transitions. Order matters only for tests: the renderer
        // event is dispatched first to keep its perceived latency unchanged.
        aiAgentNotifier.observe(info);
      },
    },
  });
  const applyRuntimeSettings = (settings: AppSettings): AppSettings => {
    paneInfoTracker.setPollIntervalMs(settings.paneInfo.pollIntervalMs);
    shellIntegrationInjector.setAutoInject(settings.shellIntegration.autoInject);
    const acceptedHotkey = hotkeyManager.set(settings.shortcuts.activateAppHotkey);
    if (acceptedHotkey !== settings.shortcuts.activateAppHotkey) {
      return settingsStore.update({ shortcuts: { activateAppHotkey: acceptedHotkey } });
    }

    return settings;
  };
  const ptyManager = new PtyManager({
    shellIntegrationInjector,
    logger: logger.child('pty'),
    callbacks: {
      onData: (event) => {
        const window = options.getWindow();
        // PTY processes are owned by main, so their callbacks can outlive a BrowserWindow. Drop
        // late events instead of letting a closed window turn process output into an app error.
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC.PTY_DATA, event);
        }
      },
      onExit: (event) => {
        const window = options.getWindow();
        // Exit notifications are best-effort UI updates; the manager has already cleaned up the
        // process record, so there is nothing to recover if no renderer is present.
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC.PTY_EXIT, event);
        }
      },
      onCreate: ({ id, pid, cwd }) => {
        paneInfoTracker.register(id, pid, cwd);
      },
      onDispose: ({ id }) => {
        paneInfoTracker.unregister(id);
        // Drop notifier state too so a reused ptyId starts from a clean snapshot.
        aiAgentNotifier.unregister(id);
      },
      onSignal: ({ id, signal }) => {
        paneInfoTracker.applySignal(id, signal);
      },
      onUserInput: ({ id }) => {
        paneInfoTracker.notifyUserInput(id);
      },
    },
  });
  const tunnelManager = new TunnelManager({
    onStatusChanged: (event) => {
      const window = options.getWindow();
      // Tunnel processes can outlive a BrowserWindow; late runtime events are best-effort UI
      // updates and should be dropped when no renderer is available.
      if (isWindowAvailable(window)) {
        window.webContents.send(IPC.TUNNEL_STATUS_CHANGED, event);
      }
    },
    onLog: (event) => {
      const window = options.getWindow();
      // Keep the preload/API contract as `data` while allowing TunnelManager to use its more
      // precise internal `line` name.
      if (isWindowAvailable(window)) {
        window.webContents.send(IPC.TUNNEL_LOG, {
          alias: event.alias,
          data: event.line,
        });
      }
    },
  });
  const shortcutDispatchers = createShortcutDispatcher(options.getWindow);
  const menuController: MenuController = createMenuController({
    settingsStore,
    dispatchers: shortcutDispatchers,
    getWindow: options.getWindow,
    openHelp: (): void => {
      // Help menu currently points at the GitHub homepage; same URL the README and About dialog
      // already advertise so users land somewhere recognisable.
      void shell.openExternal('https://github.com/ytakahashi/evermore');
    },
    isDev: options.isDev ?? false,
    setApplicationMenu: (template: MenuItemConstructorOptions[]): void => {
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    },
  });
  const disposePtyHandlers = registerPtyHandlers({ getWindow: options.getWindow, ptyManager });
  const disposePaneInfoHandlers = registerPaneInfoHandlers({
    getWindow: options.getWindow,
    paneInfoTracker,
  });
  const disposeWorkspaceHandlers = registerWorkspaceHandlers();
  const disposeSshHandlers = registerSshHandlers({ sshConfigManager, sshHostResolver });
  applyRuntimeSettings(settingsStore.get());
  const disposeSettingsHandlers = registerSettingsHandlers({ settingsStore, applyRuntimeSettings });
  const disposeTunnelHandlers = registerTunnelHandlers({
    sshConfigManager,
    tunnelManager,
    logger: logger.child('tunnels'),
  });
  const disposeWindowHandlers = registerWindowHandlers({
    getWindow: options.getWindow,
  });

  return {
    hasActiveTunnelForQuitConfirm: () =>
      tunnelManager.list().some((runtimeEntry) => {
        // `error` is intentionally ignored here because it represents a settled tunnel failure,
        // not an active SSH process that quit confirmation needs to protect.
        return runtimeEntry.state.status === 'starting' || runtimeEntry.state.status === 'running';
      }),
    hotkeyManager,
    paneInfoTracker,
    dispose: () => {
      disposePtyHandlers();
      disposePaneInfoHandlers();
      disposeWorkspaceHandlers();
      disposeSshHandlers();
      disposeSettingsHandlers();
      disposeTunnelHandlers();
      disposeWindowHandlers();
      hotkeyManager.dispose();
      paneInfoTracker.dispose();
      menuController.dispose();
      notificationService.dispose();
    },
  };
}
