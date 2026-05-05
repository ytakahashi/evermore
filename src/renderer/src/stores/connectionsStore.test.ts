import { describe, expect, it, vi } from 'vitest';
import type { SSHHost } from '../../../shared/types';
import { createConnectionsStore } from './connectionsStore';

const hosts: SSHHost[] = [
  {
    alias: 'dev',
    hostname: 'dev.example.com',
    hasForwarding: false,
    forwards: [],
  },
];

describe('connectionsStore', () => {
  it('loads SSH hosts through the API', async () => {
    // Given: the preload SSH API returns parsed hosts.
    const sshApi = {
      listHosts: vi.fn(() => Promise.resolve(hosts)),
      reloadHosts: vi.fn(() => Promise.resolve([])),
    };
    const useStore = createConnectionsStore({ sshApi });

    // When: hosts are loaded.
    await useStore.getState().loadHosts();

    // Then: the store exposes the host list.
    expect(sshApi.listHosts).toHaveBeenCalledOnce();
    expect(useStore.getState()).toMatchObject({
      hosts,
      isLoading: false,
      error: null,
    });
  });

  it('reloads SSH hosts through the refresh API', async () => {
    // Given: a reloaded host list is available.
    const reloadedHosts: SSHHost[] = [{ ...hosts[0], alias: 'reloaded' }];
    const sshApi = {
      listHosts: vi.fn(() => Promise.resolve([])),
      reloadHosts: vi.fn(() => Promise.resolve(reloadedHosts)),
    };
    const useStore = createConnectionsStore({ sshApi });

    // When: hosts are reloaded.
    await useStore.getState().reloadHosts();

    // Then: reload uses the cache-busting API.
    expect(sshApi.reloadHosts).toHaveBeenCalledOnce();
    expect(useStore.getState().hosts).toEqual(reloadedHosts);
  });

  it('stores an error message when loading fails', async () => {
    // Given: the SSH API rejects.
    const sshApi = {
      listHosts: vi.fn(() => Promise.reject(new Error('cannot read config'))),
      reloadHosts: vi.fn(() => Promise.resolve([])),
    };
    const useStore = createConnectionsStore({ sshApi });

    // When: hosts are loaded.
    await useStore.getState().loadHosts();

    // Then: the failure is captured for the sidebar UI.
    expect(useStore.getState()).toMatchObject({
      hosts: [],
      isLoading: false,
      error: 'cannot read config',
    });
  });
});
