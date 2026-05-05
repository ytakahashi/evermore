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

  it('removes the list handler during teardown', () => {
    // Given: SSH handlers have been registered.
    const dispose = registerSshHandlers({
      sshConfigManager: {
        list: vi.fn(() => []),
      },
    });

    // When: registration is disposed.
    dispose();

    // Then: the IPC handler is removed.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.SSH_LIST_HOSTS);
  });
});
