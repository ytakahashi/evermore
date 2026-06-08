import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost, Tunnel } from '../../../shared/types';
import { createSilentLogger, type Logger } from '../../logging/logger';
import type { SshConfigManager } from '../../ssh-config/manager';
import type { TunnelManager } from '../../tunnels/tunnel-manager';
import { assertIpcRequestAllowed } from '../authorization';
import { readAliasPayload } from '../validation';

type TunnelSshConfigManager = Pick<SshConfigManager, 'list'>;
type TunnelRuntimeManager = Pick<
  TunnelManager,
  'start' | 'stop' | 'getRuntimeState' | 'list' | 'logs' | 'clearDiagnostics' | 'disposeAll'
>;

interface RegisterTunnelHandlersOptions {
  sshConfigManager: TunnelSshConfigManager;
  tunnelManager: TunnelRuntimeManager;
  /**
   * Logger for diagnostics such as the "still running but no longer configured" warning. Optional
   * so tests can omit it and inherit a silent default.
   */
  logger?: Logger;
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

function isConfiguredForwardingAlias(hosts: SSHHost[], alias: string): boolean {
  return hosts.some((host) => host.alias === alias && host.hasForwarding);
}

/**
 * Bridges renderer tunnel requests to the main-process tunnel runtime manager.
 */
export function registerTunnelHandlers(options: RegisterTunnelHandlersOptions): () => void {
  const { tunnelManager } = options;
  const logger = options.logger ?? createSilentLogger();

  const canControlExistingTunnel = (hosts: SSHHost[], alias: string): boolean =>
    isConfiguredForwardingAlias(hosts, alias) ||
    tunnelManager.list().some((entry) => entry.alias === alias);

  const warnAboutUnconfiguredActiveTunnels = (hosts: SSHHost[]): void => {
    const configuredTunnelAliases = new Set(
      hosts.filter((host) => host.hasForwarding).map((host) => host.alias),
    );

    for (const runtimeEntry of tunnelManager.list()) {
      if (
        !configuredTunnelAliases.has(runtimeEntry.alias) &&
        (runtimeEntry.state.status === 'starting' || runtimeEntry.state.status === 'running')
      ) {
        logger.warn(
          `SSH tunnel "${runtimeEntry.alias}" is ${runtimeEntry.state.status} but is no longer configured in ~/.ssh/config. Leaving the process running until it is stopped or the app quits.`,
        );
      }
    }
  };

  ipcMain.handle(IPC.TUNNEL_LIST, () => {
    const hosts = options.sshConfigManager.list();
    warnAboutUnconfiguredActiveTunnels(hosts);

    return hosts.filter((host) => host.hasForwarding).map((host) => toTunnel(host, tunnelManager));
  });
  ipcMain.handle(IPC.TUNNEL_START, (_event, payload: unknown) => {
    const alias = readAliasPayload(payload, IPC.TUNNEL_START);
    const hosts = options.sshConfigManager.list();
    assertIpcRequestAllowed(IPC.TUNNEL_START, isConfiguredForwardingAlias(hosts, alias));
    tunnelManager.start(alias);
  });
  ipcMain.handle(IPC.TUNNEL_STOP, (_event, payload: unknown) => {
    const alias = readAliasPayload(payload, IPC.TUNNEL_STOP);
    const hosts = options.sshConfigManager.list();
    assertIpcRequestAllowed(IPC.TUNNEL_STOP, canControlExistingTunnel(hosts, alias));
    tunnelManager.stop(alias);
  });
  ipcMain.handle(IPC.TUNNEL_LOGS, (_event, payload: unknown) => {
    const alias = readAliasPayload(payload, IPC.TUNNEL_LOGS);
    const hosts = options.sshConfigManager.list();
    assertIpcRequestAllowed(IPC.TUNNEL_LOGS, canControlExistingTunnel(hosts, alias));
    return tunnelManager.logs(alias);
  });
  ipcMain.handle(IPC.TUNNEL_CLEAR_DIAGNOSTICS, (_event, payload: unknown) => {
    const alias = readAliasPayload(payload, IPC.TUNNEL_CLEAR_DIAGNOSTICS);
    const hosts = options.sshConfigManager.list();
    assertIpcRequestAllowed(IPC.TUNNEL_CLEAR_DIAGNOSTICS, canControlExistingTunnel(hosts, alias));
    tunnelManager.clearDiagnostics(alias);
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
