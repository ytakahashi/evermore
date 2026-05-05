import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useTunnelsStore } from '../../stores/tunnelsStore';
import { ConnectionsView } from './ConnectionsView';

const initialConnectionsState = useConnectionsStore.getState();
const initialTunnelsState = useTunnelsStore.getState();

describe('ConnectionsView', () => {
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
  });

  it('loads SSH hosts once when mounted', () => {
    // Given: the connections store can load hosts.
    const loadHosts = vi.fn(() => Promise.resolve());
    useConnectionsStore.setState({ loadHosts });

    // When: the view renders.
    const { rerender } = render(<ConnectionsView />);
    rerender(<ConnectionsView />);

    // Then: the initial load only starts once for this mounted view.
    expect(loadHosts).toHaveBeenCalledOnce();
    expect(screen.getByText('SSH Hosts')).toBeInTheDocument();
    expect(screen.getByText('Tunnels')).toBeInTheDocument();
    expect(screen.getByText('No tunnels configured in ~/.ssh/config')).toBeInTheDocument();
  });
});
