import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost } from '../../../shared/types';
import type { TunnelRuntimeState } from '../../tunnels/types';
import { registerTunnelHandlers } from './tunnel';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

function getHandler(channel: string): ((event: unknown, payload?: unknown) => unknown) | undefined {
  return ipcMainMock.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1];
}

interface TestTunnelManager {
  start: ReturnType<typeof vi.fn<(alias: string) => void>>;
  stop: ReturnType<typeof vi.fn<(alias: string) => void>>;
  getRuntimeState: ReturnType<typeof vi.fn<(alias: string) => TunnelRuntimeState | undefined>>;
  list: ReturnType<typeof vi.fn<() => Array<{ alias: string; state: TunnelRuntimeState }>>>;
  logs: ReturnType<typeof vi.fn<(alias: string) => string[]>>;
  clearDiagnostics: ReturnType<typeof vi.fn<(alias: string) => void>>;
  disposeAll: ReturnType<typeof vi.fn<() => void>>;
}

function createTunnelManager(
  runtimeStates: Record<string, TunnelRuntimeState | undefined> = {},
): TestTunnelManager {
  return {
    start: vi.fn<(alias: string) => void>(),
    stop: vi.fn<(alias: string) => void>(),
    getRuntimeState: vi.fn<(alias: string) => TunnelRuntimeState | undefined>(
      (alias: string) => runtimeStates[alias],
    ),
    list: vi.fn<() => Array<{ alias: string; state: TunnelRuntimeState }>>(() =>
      Object.entries(runtimeStates).flatMap(([alias, state]) => (state ? [{ alias, state }] : [])),
    ),
    logs: vi.fn<(alias: string) => string[]>((alias: string) => [`${alias} log`]),
    clearDiagnostics: vi.fn<(alias: string) => void>(),
    disposeAll: vi.fn<() => void>(),
  };
}

describe('registerTunnelHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('registers tunnel handlers and joins SSH config hosts with runtime state', () => {
    // Given: SSH config has both forwarding and non-forwarding hosts.
    const hosts: SSHHost[] = [
      {
        alias: 'dev',
        hostname: 'dev.example.com',
        hasForwarding: true,
        forwards: [
          {
            type: 'local',
            bindPort: 5432,
            hostAddress: 'localhost',
            hostPort: 5432,
          },
        ],
      },
      {
        alias: 'plain',
        hostname: 'plain.example.com',
        hasForwarding: false,
        forwards: [],
      },
      {
        alias: 'staging',
        hostname: 'staging.example.com',
        hasForwarding: true,
        forwards: [
          {
            type: 'dynamic',
            bindPort: 1080,
          },
        ],
      },
    ];
    const sshConfigManager = {
      list: vi.fn(() => hosts),
    };
    const tunnelManager = createTunnelManager({
      dev: {
        status: 'running',
        pid: 1234,
        startedAt: 1000,
        lastError: undefined,
        recentLogs: ['dev ready'],
      },
    });

    // When: tunnel:list is invoked.
    registerTunnelHandlers({
      sshConfigManager,
      tunnelManager,
    });
    const handler = getHandler(IPC.TUNNEL_LIST);
    const tunnels = handler?.({});

    // Then: only forwarding hosts are returned, with stopped defaults for unseen aliases.
    expect(tunnels).toEqual([
      {
        alias: 'dev',
        forwards: hosts[0]?.forwards,
        status: 'running',
        pid: 1234,
        startedAt: 1000,
        lastError: undefined,
        recentLogs: ['dev ready'],
      },
      {
        alias: 'staging',
        forwards: hosts[2]?.forwards,
        status: 'stopped',
        pid: undefined,
        startedAt: undefined,
        lastError: undefined,
        recentLogs: [],
      },
    ]);
    expect(sshConfigManager.list).toHaveBeenCalledOnce();
    expect(tunnelManager.getRuntimeState).toHaveBeenCalledWith('dev');
    expect(tunnelManager.getRuntimeState).toHaveBeenCalledWith('staging');
    expect(tunnelManager.getRuntimeState).not.toHaveBeenCalledWith('plain');
  });

  it('delegates start, stop, and logs requests to the tunnel manager', () => {
    // Given: tunnel handlers registered with an injected runtime manager.
    const tunnelManager = createTunnelManager();
    registerTunnelHandlers({
      sshConfigManager: {
        list: vi.fn(() => []),
      },
      tunnelManager,
    });

    // When: renderer invoke handlers are called.
    getHandler(IPC.TUNNEL_START)?.({}, { alias: 'dev' });
    getHandler(IPC.TUNNEL_STOP)?.({}, { alias: 'dev' });
    const logs = getHandler(IPC.TUNNEL_LOGS)?.({}, { alias: 'dev' });

    // Then: each request is bridged to the manager.
    expect(tunnelManager.start).toHaveBeenCalledWith('dev');
    expect(tunnelManager.stop).toHaveBeenCalledWith('dev');
    expect(tunnelManager.logs).toHaveBeenCalledWith('dev');
    expect(logs).toEqual(['dev log']);
  });

  it('removes handlers and disposes all tunnels during teardown', () => {
    // Given: tunnel handlers have been registered.
    const tunnelManager = createTunnelManager();
    const dispose = registerTunnelHandlers({
      sshConfigManager: {
        list: vi.fn(() => []),
      },
      tunnelManager,
    });

    // When: registration is disposed.
    dispose();

    // Then: all tunnel IPC handlers are removed and runtime processes are disposed.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.TUNNEL_LIST);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.TUNNEL_START);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.TUNNEL_STOP);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.TUNNEL_LOGS);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.TUNNEL_CLEAR_DIAGNOSTICS);
    expect(tunnelManager.disposeAll).toHaveBeenCalledOnce();
  });

  it('delegates clearDiagnostics requests to the tunnel manager', () => {
    // Given: tunnel handlers are registered with an injected runtime manager.
    const tunnelManager = createTunnelManager();
    registerTunnelHandlers({
      sshConfigManager: { list: vi.fn(() => []) },
      tunnelManager,
    });

    // When: the renderer invokes the clear-diagnostics handler.
    getHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS)?.({}, { alias: 'dev' });

    // Then: the request is bridged to the manager.
    expect(tunnelManager.clearDiagnostics).toHaveBeenCalledWith('dev');
  });

  it('warns when an active runtime tunnel is no longer configured', () => {
    // Given: runtime state still has an active tunnel that config no longer contains.
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const sshConfigManager = {
      list: vi.fn(() => [
        {
          alias: 'configured',
          hasForwarding: true,
          forwards: [],
        },
      ]),
    };
    const tunnelManager = createTunnelManager({
      configured: {
        status: 'running',
        recentLogs: [],
      },
      removed: {
        status: 'running',
        recentLogs: [],
      },
      'failed-removed': {
        status: 'error',
        recentLogs: [],
      },
    });

    // When: renderer asks for the current tunnel list after config reload.
    registerTunnelHandlers({
      sshConfigManager,
      tunnelManager,
    });
    getHandler(IPC.TUNNEL_LIST)?.({});

    // Then: only the active unconfigured runtime tunnel is reported for developer visibility.
    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('SSH tunnel "removed" is running'),
    );
    consoleWarn.mockRestore();
  });
});
