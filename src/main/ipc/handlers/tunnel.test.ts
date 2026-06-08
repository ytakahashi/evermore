import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost } from '../../../shared/types';
import { createLogger, type LogRecord, type LogTransport } from '../../logging/logger';
import type { TunnelRuntimeState } from '../../tunnels/types';
import { MAX_ALIAS_LENGTH } from '../validation';
import {
  expectIpcRequestNotAllowed,
  expectInvalidPayload,
  ipcMainMock,
  requireHandler,
  resetIpcMainMock,
} from './test-utils/ipc-main-mock';
import { registerTunnelHandlers } from './tunnel';

interface TestTunnelManager {
  start: ReturnType<typeof vi.fn<(alias: string) => void>>;
  stop: ReturnType<typeof vi.fn<(alias: string) => void>>;
  getRuntimeState: ReturnType<typeof vi.fn<(alias: string) => TunnelRuntimeState | undefined>>;
  list: ReturnType<typeof vi.fn<() => Array<{ alias: string; state: TunnelRuntimeState }>>>;
  logs: ReturnType<typeof vi.fn<(alias: string) => string[]>>;
  clearDiagnostics: ReturnType<typeof vi.fn<(alias: string) => void>>;
  disposeAll: ReturnType<typeof vi.fn<() => void>>;
}

interface TestSshConfigManager {
  list: ReturnType<typeof vi.fn<() => SSHHost[]>>;
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

function createSshConfigManager(hosts: SSHHost[] = []): TestSshConfigManager {
  return {
    list: vi.fn(() => hosts),
  };
}

function createSshHost(alias: string, hasForwarding: boolean): SSHHost {
  return {
    alias,
    hostname: `${alias}.example.com`,
    hasForwarding,
    forwards: hasForwarding
      ? [
          {
            type: 'dynamic',
            bindPort: 1080,
          },
        ]
      : [],
  };
}

function registerWithTunnelManager(
  tunnelManager: TestTunnelManager,
  hosts: SSHHost[] = [],
): TestSshConfigManager {
  const sshConfigManager = createSshConfigManager(hosts);
  registerTunnelHandlers({
    sshConfigManager,
    tunnelManager,
  });
  return sshConfigManager;
}

const invalidAliasPayloads: Array<[string, unknown]> = [
  ['null', null],
  ['array', []],
  ['missing alias', {}],
  ['wrong-type alias', { alias: 1 }],
  ['empty alias', { alias: '' }],
  ['over-limit alias', { alias: 'x'.repeat(MAX_ALIAS_LENGTH + 1) }],
];

describe('registerTunnelHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
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
    const sshConfigManager = createSshConfigManager(hosts);
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
    const tunnels = requireHandler(IPC.TUNNEL_LIST)({});

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
    registerWithTunnelManager(tunnelManager, [createSshHost('dev', true)]);

    // When: renderer invoke handlers are called.
    requireHandler(IPC.TUNNEL_START)({}, { alias: 'dev' });
    requireHandler(IPC.TUNNEL_STOP)({}, { alias: 'dev' });
    const logs = requireHandler(IPC.TUNNEL_LOGS)({}, { alias: 'dev' });

    // Then: each request is bridged to the manager.
    expect(tunnelManager.start).toHaveBeenCalledWith('dev');
    expect(tunnelManager.stop).toHaveBeenCalledWith('dev');
    expect(tunnelManager.logs).toHaveBeenCalledWith('dev');
    expect(logs).toEqual(['dev log']);
  });

  it('ignores extra tunnel payload keys for configured forwarding aliases', () => {
    // Given: tunnel handlers registered with an injected runtime manager.
    const tunnelManager = createTunnelManager();
    registerWithTunnelManager(tunnelManager, [createSshHost('dev', true)]);

    // When: renderer invoke handlers are called with extra keys.
    requireHandler(IPC.TUNNEL_START)({}, { alias: 'dev', shell: '/bin/bash' });
    requireHandler(IPC.TUNNEL_STOP)({}, { alias: 'dev', shell: '/bin/bash' });
    const logs = requireHandler(IPC.TUNNEL_LOGS)({}, { alias: 'dev', shell: '/bin/bash' });
    requireHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS)({}, { alias: 'dev', shell: '/bin/bash' });

    // Then: only the allowed alias reaches the manager.
    expect(tunnelManager.start).toHaveBeenCalledWith('dev');
    expect(tunnelManager.stop).toHaveBeenCalledWith('dev');
    expect(tunnelManager.logs).toHaveBeenCalledWith('dev');
    expect(logs).toEqual(['dev log']);
    expect(tunnelManager.clearDiagnostics).toHaveBeenCalledWith('dev');
  });

  it('rejects tunnel:start for configured non-forwarding aliases', () => {
    // Given: SSH config contains a host without forwarding.
    const tunnelManager = createTunnelManager();
    registerWithTunnelManager(tunnelManager, [createSshHost('plain', false)]);

    // When / Then: starting a non-forwarding alias is not exposed as a renderer capability.
    expectIpcRequestNotAllowed(IPC.TUNNEL_START, () =>
      requireHandler(IPC.TUNNEL_START)({}, { alias: 'plain' }),
    );
    expect(tunnelManager.start).not.toHaveBeenCalled();
  });

  it('rejects tunnel:start for unknown aliases', () => {
    // Given: SSH config does not contain the requested alias.
    const tunnelManager = createTunnelManager();
    registerWithTunnelManager(tunnelManager, [createSshHost('dev', true)]);

    // When / Then: unknown aliases are not allowed to start tunnels.
    expectIpcRequestNotAllowed(IPC.TUNNEL_START, () =>
      requireHandler(IPC.TUNNEL_START)({}, { alias: 'unknown-dev' }),
    );
    expect(tunnelManager.start).not.toHaveBeenCalled();
  });

  it('allows runtime-only aliases for stop, logs, and clear diagnostics', () => {
    // Given: runtime state contains an alias that is no longer configured.
    const tunnelManager = createTunnelManager({
      removed: {
        status: 'error',
        recentLogs: ['failed'],
      },
    });
    registerWithTunnelManager(tunnelManager);

    // When: renderer controls the runtime-only tunnel.
    requireHandler(IPC.TUNNEL_STOP)({}, { alias: 'removed' });
    const logs = requireHandler(IPC.TUNNEL_LOGS)({}, { alias: 'removed' });
    requireHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS)({}, { alias: 'removed' });

    // Then: runtime state presence preserves access after SSH config changes.
    expect(tunnelManager.stop).toHaveBeenCalledWith('removed');
    expect(tunnelManager.logs).toHaveBeenCalledWith('removed');
    expect(logs).toEqual(['removed log']);
    expect(tunnelManager.clearDiagnostics).toHaveBeenCalledWith('removed');
  });

  it.each([
    [IPC.TUNNEL_STOP, 'stop'],
    [IPC.TUNNEL_LOGS, 'logs'],
    [IPC.TUNNEL_CLEAR_DIAGNOSTICS, 'clearDiagnostics'],
  ] as const)(
    'rejects %s for unknown aliases',
    (channel, methodName: 'stop' | 'logs' | 'clearDiagnostics') => {
      // Given: neither SSH config nor runtime state contains the requested alias.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager, [createSshHost('dev', true)]);

      // When / Then: unknown aliases are not allowed for the channel.
      expectIpcRequestNotAllowed(channel, () =>
        requireHandler(channel)({}, { alias: 'unknown-dev' }),
      );
      expect(tunnelManager[methodName]).not.toHaveBeenCalled();
    },
  );

  it.each([
    [IPC.TUNNEL_STOP, 'stop'],
    [IPC.TUNNEL_LOGS, 'logs'],
    [IPC.TUNNEL_CLEAR_DIAGNOSTICS, 'clearDiagnostics'],
  ] as const)(
    'rejects %s for configured non-forwarding aliases without runtime state',
    (channel, methodName: 'stop' | 'logs' | 'clearDiagnostics') => {
      // Given: SSH config contains a non-forwarding host and runtime state has no matching alias.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager, [createSshHost('plain', false)]);

      // When / Then: non-forwarding aliases are not exposed unless runtime state exists.
      expectIpcRequestNotAllowed(channel, () => requireHandler(channel)({}, { alias: 'plain' }));
      expect(tunnelManager[methodName]).not.toHaveBeenCalled();
    },
  );

  it('allows configured forwarding aliases for clear diagnostics', () => {
    // Given: tunnel handlers are registered with an injected runtime manager.
    const tunnelManager = createTunnelManager();
    registerWithTunnelManager(tunnelManager, [createSshHost('dev', true)]);

    // When: the renderer invokes the clear-diagnostics handler.
    requireHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS)({}, { alias: 'dev' });

    // Then: the request is bridged to the manager.
    expect(tunnelManager.clearDiagnostics).toHaveBeenCalledWith('dev');
  });

  it.each(invalidAliasPayloads)(
    'rejects invalid tunnel:start payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: tunnel handlers registered with an injected runtime manager.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager);

      // When / Then: malformed payloads are rejected before manager execution.
      expectInvalidPayload(IPC.TUNNEL_START, () => requireHandler(IPC.TUNNEL_START)({}, payload));
      expect(tunnelManager.start).not.toHaveBeenCalled();
    },
  );

  it.each(invalidAliasPayloads)(
    'rejects invalid tunnel:stop payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: tunnel handlers registered with an injected runtime manager.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager);

      // When / Then: malformed payloads are rejected before manager execution.
      expectInvalidPayload(IPC.TUNNEL_STOP, () => requireHandler(IPC.TUNNEL_STOP)({}, payload));
      expect(tunnelManager.stop).not.toHaveBeenCalled();
    },
  );

  it.each(invalidAliasPayloads)(
    'rejects invalid tunnel:logs payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: tunnel handlers registered with an injected runtime manager.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager);

      // When / Then: malformed payloads are rejected before manager execution.
      expectInvalidPayload(IPC.TUNNEL_LOGS, () => requireHandler(IPC.TUNNEL_LOGS)({}, payload));
      expect(tunnelManager.logs).not.toHaveBeenCalled();
    },
  );

  it.each(invalidAliasPayloads)(
    'rejects invalid tunnel:clear-diagnostics payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: tunnel handlers registered with an injected runtime manager.
      const tunnelManager = createTunnelManager();
      registerWithTunnelManager(tunnelManager);

      // When / Then: malformed payloads are rejected before manager execution.
      expectInvalidPayload(IPC.TUNNEL_CLEAR_DIAGNOSTICS, () =>
        requireHandler(IPC.TUNNEL_CLEAR_DIAGNOSTICS)({}, payload),
      );
      expect(tunnelManager.clearDiagnostics).not.toHaveBeenCalled();
    },
  );

  it('removes handlers and disposes all tunnels during teardown', () => {
    // Given: tunnel handlers have been registered.
    const tunnelManager = createTunnelManager();
    const dispose = registerTunnelHandlers({
      sshConfigManager: createSshConfigManager(),
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

  it('warns when an active runtime tunnel is no longer configured', () => {
    // Given: runtime state still has an active tunnel that config no longer contains, and a
    // recording logger captures warn records.
    const records: LogRecord[] = [];
    const transport: LogTransport = {
      write(record) {
        records.push(record);
      },
    };
    const logger = createLogger({ level: 'debug', transport });
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
      logger,
    });
    requireHandler(IPC.TUNNEL_LIST)({});

    // Then: only the active unconfigured runtime tunnel is reported through the injected logger.
    const warnRecords = records.filter((record) => record.level === 'warn');
    expect(warnRecords).toHaveLength(1);
    expect(warnRecords[0]?.message).toEqual(
      expect.stringContaining('SSH tunnel "removed" is running'),
    );
  });
});
