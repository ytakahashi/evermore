import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost, Tunnel } from '../../../shared/types';
import type { SshConfigManager } from '../../ssh-config/manager';
import { TunnelManager } from '../../tunnels/tunnel-manager';

type TunnelSshConfigManager = Pick<SshConfigManager, 'list'>;
type TunnelRuntimeManager = Pick<
  TunnelManager,
  'start' | 'stop' | 'getRuntimeState' | 'logs' | 'disposeAll'
>;

interface RegisterTunnelHandlersOptions {
  getWindow: () => BrowserWindow | null;
  sshConfigManager: TunnelSshConfigManager;
  tunnelManager?: TunnelRuntimeManager;
}

function isWindowAvailable(window: BrowserWindow | null): window is BrowserWindow {
  return window !== null && !window.isDestroyed();
}

function toTunnel(host: SSHHost, tunnelManager: TunnelRuntimeManager): Tunnel {
  const runtimeState = tunnelManager.getRuntimeState(host.alias);

  return {
    alias: host.alias,
    // Shares the array reference owned by SshConfigManager's cache. IPC structured-clone breaks
    // the alias at the renderer boundary, so this is only safe while no main-process consumer
    // mutates the result of tunnel:list. Clone (e.g. `[...host.forwards]`) before adding any
    // forwards-mutating logic here.
    forwards: host.forwards,
    status: runtimeState?.status ?? 'stopped',
    pid: runtimeState?.pid,
    startedAt: runtimeState?.startedAt,
    lastError: runtimeState?.lastError,
    recentLogs: runtimeState?.recentLogs ?? [],
  };
}

/**
 * Bridges renderer tunnel requests to the main-process tunnel runtime manager.
 */
export function registerTunnelHandlers(options: RegisterTunnelHandlersOptions): () => void {
  const tunnelManager =
    options.tunnelManager ??
    new TunnelManager({
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

  ipcMain.handle(IPC.TUNNEL_LIST, () =>
    options.sshConfigManager
      .list()
      .filter((host) => host.hasForwarding)
      .map((host) => toTunnel(host, tunnelManager)),
  );
  ipcMain.handle(IPC.TUNNEL_START, (_event, payload: { alias: string }) => {
    tunnelManager.start(payload.alias);
  });
  ipcMain.handle(IPC.TUNNEL_STOP, (_event, payload: { alias: string }) => {
    tunnelManager.stop(payload.alias);
  });
  ipcMain.handle(IPC.TUNNEL_LOGS, (_event, payload: { alias: string }) =>
    tunnelManager.logs(payload.alias),
  );

  return () => {
    ipcMain.removeHandler(IPC.TUNNEL_LIST);
    ipcMain.removeHandler(IPC.TUNNEL_START);
    ipcMain.removeHandler(IPC.TUNNEL_STOP);
    ipcMain.removeHandler(IPC.TUNNEL_LOGS);
    tunnelManager.disposeAll();
  };
}
