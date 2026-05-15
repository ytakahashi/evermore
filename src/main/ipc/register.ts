import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { AppSettings } from '../../shared/types';
import { HotkeyManager } from '../hotkey/hotkey-manager';
import { PaneInfoTracker } from '../pane-info/pane-info-tracker';
import { PtyManager } from '../pty/pty-manager';
import { SettingsStore } from '../settings/settings-store';
import { TunnelManager } from '../tunnels/tunnel-manager';
import { registerPtyHandlers } from './handlers/pty';
import { registerPaneInfoHandlers } from './handlers/pane-info';
import { registerSettingsHandlers } from './handlers/settings';
import { registerSshHandlers } from './handlers/ssh';
import { registerTunnelHandlers } from './handlers/tunnel';
import { registerWorkspaceHandlers } from './handlers/workspace';
import { SshConfigManager } from '../ssh-config/manager';
import { SshHostResolver } from '../ssh-config/host-resolver';

interface RegisterIpcHandlersOptions {
  getWindow: () => BrowserWindow | null;
  settingsStore?: SettingsStore;
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
  const settingsStore = options.settingsStore ?? new SettingsStore();
  const sshConfigManager = new SshConfigManager();
  const sshHostResolver = new SshHostResolver();
  const paneInfoTracker = new PaneInfoTracker({
    pollIntervalMs: settingsStore.get().paneInfo.pollIntervalMs,
    callbacks: {
      onChanged: ({ info }) => {
        const window = options.getWindow();
        if (window && !window.isDestroyed()) {
          window.webContents.send(IPC.PANE_INFO_CHANGED, info);
        }
      },
    },
  });
  const hotkeyManager = new HotkeyManager({ getWindow: options.getWindow });
  const applyRuntimeSettings = (settings: AppSettings): AppSettings => {
    paneInfoTracker.setPollIntervalMs(settings.paneInfo.pollIntervalMs);
    const acceptedHotkey = hotkeyManager.set(settings.shortcuts.activateAppHotkey);
    if (acceptedHotkey !== settings.shortcuts.activateAppHotkey) {
      return settingsStore.update({ shortcuts: { activateAppHotkey: acceptedHotkey } });
    }

    return settings;
  };
  const ptyManager = new PtyManager({
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
    onCreate: ({ id, pid }) => {
      paneInfoTracker.register(id, pid);
    },
    onDispose: ({ id }) => {
      paneInfoTracker.unregister(id);
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
  });

  return {
    hasActiveTunnelForQuitConfirm: () =>
      tunnelManager.list().some((runtimeEntry) => {
        // `error` is intentionally ignored here: TunnelManager clears the child-process reference
        // before entering that state, so there is no active SSH process left to protect.
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
      hotkeyManager.dispose();
      paneInfoTracker.dispose();
    },
  };
}
