import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost, Tunnel } from '../../../shared/types';
import type { SshConfigManager } from '../../ssh-config/manager';
import type { TunnelManager } from '../../tunnels/tunnel-manager';

type TunnelSshConfigManager = Pick<SshConfigManager, 'list'>;
type TunnelRuntimeManager = Pick<
  TunnelManager,
  'start' | 'stop' | 'getRuntimeState' | 'list' | 'logs' | 'clearDiagnostics' | 'disposeAll'
>;

interface RegisterTunnelHandlersOptions {
  sshConfigManager: TunnelSshConfigManager;
  tunnelManager: TunnelRuntimeManager;
}

function toTunnel(host: SSHHost, tunnelManager: TunnelRuntimeManager): Tunnel {
  const runtimeState = tunnelManager.getRuntimeState(host.alias);

  return {
    alias: host.alias,
    // Clone the array to prevent accidental mutation of the SshConfigManager's cache.
    forwards: [...host.forwards],
    status: runtimeState?.status ?? 'stopped',
    pid: runtimeState?.pid,
    startedAt: runtimeState?.startedAt,
    lastError: runtimeState?.lastError,
    recentLogs: runtimeState?.recentLogs ?? [],
  };
}

function warnAboutUnconfiguredActiveTunnels(
  hosts: SSHHost[],
  tunnelManager: TunnelRuntimeManager,
): void {
  const configuredTunnelAliases = new Set(
    hosts.filter((host) => host.hasForwarding).map((host) => host.alias),
  );

  for (const runtimeEntry of tunnelManager.list()) {
    if (
      !configuredTunnelAliases.has(runtimeEntry.alias) &&
      (runtimeEntry.state.status === 'starting' || runtimeEntry.state.status === 'running')
    ) {
      console.warn(
        `[Evermore] SSH tunnel "${runtimeEntry.alias}" is ${runtimeEntry.state.status} but is no longer configured in ~/.ssh/config. Leaving the process running until it is stopped or the app quits.`,
      );
    }
  }
}

/**
 * Bridges renderer tunnel requests to the main-process tunnel runtime manager.
 */
export function registerTunnelHandlers(options: RegisterTunnelHandlersOptions): () => void {
  const { tunnelManager } = options;

  ipcMain.handle(IPC.TUNNEL_LIST, () => {
    const hosts = options.sshConfigManager.list();
    warnAboutUnconfiguredActiveTunnels(hosts, tunnelManager);

    return hosts.filter((host) => host.hasForwarding).map((host) => toTunnel(host, tunnelManager));
  });
  ipcMain.handle(IPC.TUNNEL_START, (_event, payload: { alias: string }) => {
    tunnelManager.start(payload.alias);
  });
  ipcMain.handle(IPC.TUNNEL_STOP, (_event, payload: { alias: string }) => {
    tunnelManager.stop(payload.alias);
  });
  ipcMain.handle(IPC.TUNNEL_LOGS, (_event, payload: { alias: string }) =>
    tunnelManager.logs(payload.alias),
  );
  ipcMain.handle(IPC.TUNNEL_CLEAR_DIAGNOSTICS, (_event, payload: { alias: string }) => {
    tunnelManager.clearDiagnostics(payload.alias);
  });

  return () => {
    ipcMain.removeHandler(IPC.TUNNEL_LIST);
    ipcMain.removeHandler(IPC.TUNNEL_START);
    ipcMain.removeHandler(IPC.TUNNEL_STOP);
    ipcMain.removeHandler(IPC.TUNNEL_LOGS);
    ipcMain.removeHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS);
    tunnelManager.disposeAll();
  };
}
