import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost } from '../../../shared/types';
import { MAX_ALIAS_LENGTH } from '../validation';
import {
  expectInvalidPayload,
  ipcMainMock,
  requireHandler,
  resetIpcMainMock,
} from './test-utils/ipc-main-mock';
import { registerSshHandlers } from './ssh';

describe('registerSshHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('registers ssh:list-hosts and returns manager results', () => {
    // Given: a manager with parsed hosts.
    const hosts: SSHHost[] = [
      {
        alias: 'dev',
        hostname: 'dev.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ];
    const sshConfigManager = {
      list: vi.fn(() => hosts),
      refresh: vi.fn(() => []),
    };

    // When: SSH handlers are registered and the list handler is invoked.
    registerSshHandlers({ sshConfigManager });

    // Then: the handler bridges to the manager.
    expect(requireHandler(IPC.SSH_LIST_HOSTS)({})).toBe(hosts);
    expect(sshConfigManager.list).toHaveBeenCalledOnce();
  });

  it('registers ssh:reload-hosts and returns refreshed manager results', () => {
    // Given: a manager and a resolver.
    const hosts: SSHHost[] = [
      {
        alias: 'reloaded',
        hostname: 'reloaded.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ];
    const sshConfigManager = {
      list: vi.fn(() => []),
      refresh: vi.fn(() => hosts),
    };
    const sshHostResolver = {
      resolve: vi.fn(),
      clear: vi.fn(),
    };

    // When: SSH handlers are registered and the reload handler is invoked.
    registerSshHandlers({ sshConfigManager, sshHostResolver });
    const result = requireHandler(IPC.SSH_RELOAD_HOSTS)({});

    // Then: the handler bridges to refresh and clears the resolver cache.
    expect(result).toBe(hosts);
    expect(sshConfigManager.refresh).toHaveBeenCalledOnce();
    expect(sshHostResolver.clear).toHaveBeenCalledOnce();
  });

  it('registers ssh:resolve and returns resolver results', async () => {
    // Given: a resolver with some resolved data.
    const resolvedData = { hostname: ['1.2.3.4'] };
    const sshHostResolver = {
      resolve: vi.fn(() => Promise.resolve(resolvedData)),
      clear: vi.fn(),
    };

    // When: SSH handlers are registered and the resolve handler is invoked.
    registerSshHandlers({ sshHostResolver });
    const result = await requireHandler(IPC.SSH_RESOLVE)({}, { alias: 'my-host' });

    // Then: the handler bridges to the resolver.
    expect(result).toBe(resolvedData);
    expect(sshHostResolver.resolve).toHaveBeenCalledWith('my-host');
  });

  it('ignores extra resolve payload keys and still allows well-formed unknown aliases', async () => {
    // Given: a resolver with some resolved data.
    const resolvedData = { hostname: ['unknown.example.com'] };
    const sshHostResolver = {
      resolve: vi.fn(() => Promise.resolve(resolvedData)),
      clear: vi.fn(),
    };

    // When: SSH handlers are registered and resolve is invoked with extra keys.
    registerSshHandlers({ sshHostResolver });
    const result = await requireHandler(IPC.SSH_RESOLVE)(
      {},
      { alias: 'unknown-host', command: 'ignored' },
    );

    // Then: Phase 3 validates shape only and forwards the alias to the resolver.
    expect(result).toBe(resolvedData);
    expect(sshHostResolver.resolve).toHaveBeenCalledWith('unknown-host');
  });

  it.each([
    ['null', null],
    ['array', []],
    ['missing alias', {}],
    ['wrong-type alias', { alias: 1 }],
    ['empty alias', { alias: '' }],
    ['over-limit alias', { alias: 'x'.repeat(MAX_ALIAS_LENGTH + 1) }],
  ])('rejects invalid resolve payloads: %s', (_label: string, payload: unknown) => {
    // Given: SSH handlers are registered with an injected resolver.
    const sshHostResolver = {
      resolve: vi.fn(),
      clear: vi.fn(),
    };
    registerSshHandlers({ sshHostResolver });

    // When / Then: malformed payloads are rejected before resolver execution.
    expectInvalidPayload(IPC.SSH_RESOLVE, () => requireHandler(IPC.SSH_RESOLVE)({}, payload));
    expect(sshHostResolver.resolve).not.toHaveBeenCalled();
  });

  it('propagates resolver errors to the renderer', async () => {
    // Given: a resolver that rejects (e.g., ssh exits non-zero).
    const sshHostResolver = {
      resolve: vi.fn(() => Promise.reject(new Error('ssh failed'))),
      clear: vi.fn(),
    };

    // When: SSH handlers are registered and the resolve handler is invoked for a failing alias.
    registerSshHandlers({ sshHostResolver });

    // Then: the rejection propagates to the IPC caller without being swallowed.
    await expect(requireHandler(IPC.SSH_RESOLVE)({}, { alias: 'broken' })).rejects.toThrow(
      'ssh failed',
    );
    expect(sshHostResolver.resolve).toHaveBeenCalledWith('broken');
  });

  it('removes the ssh handlers during teardown', () => {
    // Given: SSH handlers have been registered.
    const dispose = registerSshHandlers({
      sshConfigManager: {
        list: vi.fn(() => []),
        refresh: vi.fn(() => []),
      },
    });

    // When: registration is disposed.
    dispose();

    // Then: the IPC handlers are removed.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SSH_LIST_HOSTS);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SSH_RELOAD_HOSTS);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SSH_RESOLVE);
  });
});
