import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost } from '../../../shared/types';
import type {
  TunnelLogEvent,
  TunnelManagerCallbacks,
  TunnelRuntimeState,
  TunnelStatusChangedEvent,
} from '../../tunnels/types';
import { registerTunnelHandlers } from './tunnel';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));
const tunnelManagerMock = vi.hoisted(() => ({
  callbacks: undefined as TunnelManagerCallbacks | undefined,
  disposeAll: vi.fn(),
  getRuntimeState: vi.fn(),
  logs: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

vi.mock('../../tunnels/tunnel-manager', () => ({
  TunnelManager: vi.fn().mockImplementation(function (callbacks: TunnelManagerCallbacks) {
    tunnelManagerMock.callbacks = callbacks;
    return {
      disposeAll: tunnelManagerMock.disposeAll,
      getRuntimeState: tunnelManagerMock.getRuntimeState,
      logs: tunnelManagerMock.logs,
      start: tunnelManagerMock.start,
      stop: tunnelManagerMock.stop,
    };
  }),
}));

function getHandler(channel: string): ((event: unknown, payload?: unknown) => unknown) | undefined {
  return ipcMainMock.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1];
}

function createWindowMock(isDestroyed = false): {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return {
    isDestroyed: vi.fn(() => isDestroyed),
    webContents: {
      send: vi.fn(),
    },
  };
}

interface TestTunnelManager {
  start: ReturnType<typeof vi.fn<(alias: string) => void>>;
  stop: ReturnType<typeof vi.fn<(alias: string) => void>>;
  getRuntimeState: ReturnType<typeof vi.fn<(alias: string) => TunnelRuntimeState | undefined>>;
  logs: ReturnType<typeof vi.fn<(alias: string) => string[]>>;
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
    logs: vi.fn<(alias: string) => string[]>((alias: string) => [`${alias} log`]),
    disposeAll: vi.fn<() => void>(),
  };
}

describe('registerTunnelHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    tunnelManagerMock.callbacks = undefined;
    tunnelManagerMock.disposeAll.mockClear();
    tunnelManagerMock.getRuntimeState.mockClear();
    tunnelManagerMock.logs.mockClear();
    tunnelManagerMock.start.mockClear();
    tunnelManagerMock.stop.mockClear();
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
      getWindow: () => null,
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
      getWindow: () => null,
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
      getWindow: () => null,
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
    expect(tunnelManager.disposeAll).toHaveBeenCalledOnce();
  });

  it('broadcasts status and log events from the default tunnel manager callbacks', () => {
    // Given: registering without an injected tunnel manager wires callbacks to the current window.
    const window = createWindowMock();
    registerTunnelHandlers({
      getWindow: () => window as unknown as BrowserWindow,
      sshConfigManager: {
        list: vi.fn(() => []),
      },
    });

    // When: runtime callbacks publish a status and a log line.
    const statusEvent: TunnelStatusChangedEvent = {
      alias: 'dev',
      status: 'error',
      error: 'bind failed',
    };
    const logEvent: TunnelLogEvent = {
      alias: 'dev',
      line: '2026-05-06T00:00:00.000Z bind failed',
    };
    tunnelManagerMock.callbacks?.onStatusChanged(statusEvent);
    tunnelManagerMock.callbacks?.onLog(logEvent);

    // Then: status payload is forwarded as-is and log line is adapted to the existing `data` API.
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.TUNNEL_STATUS_CHANGED, statusEvent);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.TUNNEL_LOG, {
      alias: 'dev',
      data: '2026-05-06T00:00:00.000Z bind failed',
    });
  });

  it('does not broadcast tunnel events after the window is destroyed', () => {
    // Given: the current BrowserWindow has already been destroyed.
    const window = createWindowMock(true);
    registerTunnelHandlers({
      getWindow: () => window as unknown as BrowserWindow,
      sshConfigManager: {
        list: vi.fn(() => []),
      },
    });

    // When: runtime callbacks fire late.
    tunnelManagerMock.callbacks?.onStatusChanged({
      alias: 'dev',
      status: 'running',
    });
    tunnelManagerMock.callbacks?.onLog({
      alias: 'dev',
      line: 'late log',
    });

    // Then: the event is dropped instead of touching a dead renderer.
    expect(window.webContents.send).not.toHaveBeenCalled();
  });
});
