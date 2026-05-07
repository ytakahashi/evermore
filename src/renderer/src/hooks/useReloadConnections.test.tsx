import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectionsStore } from '../stores/connectionsStore';
import { useTunnelsStore } from '../stores/tunnelsStore';
import { useSshResolutionsStore } from '../stores/sshResolutionsStore';
import { useReloadConnections } from './useReloadConnections';

const initialConnectionsState = useConnectionsStore.getState();
const initialTunnelsState = useTunnelsStore.getState();
const initialSshResolutionsState = useSshResolutionsStore.getState();

describe('useReloadConnections', () => {
  afterEach(() => {
    useConnectionsStore.setState({
      hosts: [],
      isLoading: false,
      error: null,
      loadHosts: initialConnectionsState.loadHosts,
      reloadHosts: initialConnectionsState.reloadHosts,
    });
    useTunnelsStore.setState({
      tunnels: [],
      isLoading: false,
      error: null,
      loadTunnels: initialTunnelsState.loadTunnels,
      startTunnel: initialTunnelsState.startTunnel,
      stopTunnel: initialTunnelsState.stopTunnel,
      setStatus: initialTunnelsState.setStatus,
      appendLog: initialTunnelsState.appendLog,
    });
    useSshResolutionsStore.setState({
      resolutions: {},
      resolveAlias: initialSshResolutionsState.resolveAlias,
      clear: initialSshResolutionsState.clear,
    });
  });

  it('reloads SSH hosts before loading tunnels and clears resolution cache', async () => {
    // Given: SSH host reload is delayed.
    let resolveReload: () => void = () => undefined;
    let reloadPromise: Promise<void> = Promise.resolve();
    const reloadHosts = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        }),
    );
    const loadTunnels = vi.fn(() => Promise.resolve());
    const clearResolutions = vi.fn();
    useConnectionsStore.setState({ reloadHosts });
    useTunnelsStore.setState({ loadTunnels });
    useSshResolutionsStore.setState({ clear: clearResolutions });
    const { result } = renderHook(() => useReloadConnections());

    // When: the combined reload starts.
    act(() => {
      reloadPromise = result.current.reloadConnections();
    });

    // Then: tunnel loading and resolution clearing wait for SSH config reload.
    expect(reloadHosts).toHaveBeenCalledOnce();
    expect(loadTunnels).not.toHaveBeenCalled();
    expect(clearResolutions).not.toHaveBeenCalled();

    resolveReload();
    await act(async () => {
      await reloadPromise;
    });

    expect(loadTunnels).toHaveBeenCalledOnce();
    expect(clearResolutions).toHaveBeenCalledOnce();
  });

  it('does not load tunnels or clear resolutions when SSH host reload leaves an error in state', async () => {
    // Given: SSH host reload reports an error.
    const reloadHosts = vi.fn(() => {
      useConnectionsStore.setState({ error: 'cannot read config' });
      return Promise.resolve();
    });
    const loadTunnels = vi.fn(() => Promise.resolve());
    const clearResolutions = vi.fn();
    useConnectionsStore.setState({ reloadHosts });
    useTunnelsStore.setState({ loadTunnels });
    useSshResolutionsStore.setState({ clear: clearResolutions });
    const { result } = renderHook(() => useReloadConnections());

    // When: the combined reload runs.
    await act(async () => {
      await result.current.reloadConnections();
    });

    // Then: stale tunnel data and resolution cache are not cleared from a failed config parse.
    expect(reloadHosts).toHaveBeenCalledOnce();
    expect(loadTunnels).not.toHaveBeenCalled();
    expect(clearResolutions).not.toHaveBeenCalled();
  });

  it('reports reloading while either store is loading', async () => {
    // Given: the hook is mounted.
    const { result } = renderHook(() => useReloadConnections());

    // When: SSH hosts are loading.
    act(() => {
      useConnectionsStore.setState({ isLoading: true });
    });

    // Then: the combined loading flag is active.
    await waitFor(() => {
      expect(result.current.isReloading).toBe(true);
    });

    // When: tunnel loading is active instead.
    act(() => {
      useConnectionsStore.setState({ isLoading: false });
      useTunnelsStore.setState({ isLoading: true });
    });

    // Then: the combined loading flag remains active.
    await waitFor(() => {
      expect(result.current.isReloading).toBe(true);
    });
  });
});
