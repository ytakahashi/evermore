import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { SSHHost } from '../../../shared/types';
import { registerSshHandlers } from './ssh';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

describe('registerSshHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
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
    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === IPC.SSH_LIST_HOSTS,
    )?.[1];

    // Then: the handler bridges to the manager.
    expect(handler?.({})).toBe(hosts);
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
    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === IPC.SSH_RELOAD_HOSTS,
    )?.[1];

    const result = handler?.({});

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
    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === IPC.SSH_RESOLVE,
    )?.[1];

    const result = await handler?.({}, { alias: 'my-host' });

    // Then: the handler bridges to the resolver.
    expect(result).toBe(resolvedData);
    expect(sshHostResolver.resolve).toHaveBeenCalledWith('my-host');
  });

  it('propagates resolver errors to the renderer', async () => {
    // Given: a resolver that rejects (e.g., ssh exits non-zero).
    const sshHostResolver = {
      resolve: vi.fn(() => Promise.reject(new Error('ssh failed'))),
      clear: vi.fn(),
    };

    // When: SSH handlers are registered and the resolve handler is invoked for a failing alias.
    registerSshHandlers({ sshHostResolver });
    const handler = ipcMainMock.handle.mock.calls.find(
      ([channel]) => channel === IPC.SSH_RESOLVE,
    )?.[1];

    // Then: the rejection propagates to the IPC caller without being swallowed.
    await expect(handler?.({}, { alias: 'broken' })).rejects.toThrow('ssh failed');
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
