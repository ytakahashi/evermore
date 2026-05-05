import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tunnel } from '../../../../shared/types';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useTunnelsStore } from '../../stores/tunnelsStore';
import { TunnelsSection } from './TunnelsSection';

const tipText = 'Tip: Set ExitOnForwardFailure yes in ~/.ssh/config for faster error detection.';

const stoppedTunnel: Tunnel = {
  alias: 'db-tunnel',
  forwards: [
    {
      type: 'local',
      bindPort: 5433,
      hostAddress: 'localhost',
      hostPort: 5432,
    },
  ],
  status: 'stopped',
  recentLogs: [],
};

const runningTunnel: Tunnel = {
  alias: 'socks-tunnel',
  forwards: [
    {
      type: 'dynamic',
      bindPort: 1080,
    },
  ],
  status: 'running',
  recentLogs: ['ready'],
};

const errorTunnel: Tunnel = {
  alias: 'api-tunnel',
  forwards: [
    {
      type: 'remote',
      bindPort: 8080,
      hostAddress: 'localhost',
      hostPort: 3000,
    },
    {
      type: 'local',
      bindAddress: '127.0.0.1',
      bindPort: 15432,
      hostAddress: 'db.internal',
      hostPort: 5432,
    },
  ],
  status: 'error',
  lastError: 'bind failed',
  recentLogs: ['line one', 'line two'],
};

const initialConnectionsState = useConnectionsStore.getState();
const initialTunnelsState = useTunnelsStore.getState();

describe('TunnelsSection', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it('renders tunnel rows with status dots, summaries, and actions', () => {
    // Given: tunnels in different runtime states are available.
    useTunnelsStore.setState({
      tunnels: [
        stoppedTunnel,
        runningTunnel,
        {
          ...stoppedTunnel,
          alias: 'starting-tunnel',
          status: 'starting',
        },
        errorTunnel,
      ],
    });

    // When: the section renders.
    render(<TunnelsSection />);

    // Then: rows expose status labels and appropriate lifecycle actions.
    expect(screen.getByText('db-tunnel')).toBeInTheDocument();
    expect(screen.getAllByText('127.0.0.1:5433 → localhost:5432')).not.toHaveLength(0);
    expect(screen.getByLabelText('Stopped')).toBeInTheDocument();
    expect(screen.getByLabelText('Running')).toBeInTheDocument();
    expect(screen.getByLabelText('Starting')).toBeInTheDocument();
    expect(screen.getByLabelText('Error')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Start/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Stop/ })).toHaveLength(2);
    expect(screen.getByText(tipText)).toBeInTheDocument();
  });

  it('starts and stops tunnels from row actions', () => {
    // Given: lifecycle actions are installed in the store.
    const startTunnel = vi.fn(() => Promise.resolve());
    const stopTunnel = vi.fn(() => Promise.resolve());
    useTunnelsStore.setState({
      tunnels: [stoppedTunnel, runningTunnel],
      startTunnel,
      stopTunnel,
    });

    // When: the user clicks Start and Stop.
    render(<TunnelsSection />);
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }));

    // Then: each action receives the corresponding alias.
    expect(startTunnel).toHaveBeenCalledWith('db-tunnel');
    expect(stopTunnel).toHaveBeenCalledWith('socks-tunnel');
  });

  it('expands tunnel details with forwards, last error, and recent logs', () => {
    // Given: a failed tunnel has multiple forwards and logs.
    useTunnelsStore.setState({ tunnels: [errorTunnel] });

    // When: the user expands its row.
    render(<TunnelsSection />);
    fireEvent.click(screen.getByRole('button', { name: /api-tunnel/ }));

    // Then: detailed diagnostics are visible.
    expect(screen.getByText('Last error:')).toBeInTheDocument();
    expect(screen.getByText('bind failed')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'PRE' && element.textContent === 'line one\nline two',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2 forwards')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:15432 → db.internal:5432')).toBeInTheDocument();
  });

  it('renders loading, empty, and error states with the tunnel tip', () => {
    // Given: tunnel loading is in progress.
    useTunnelsStore.setState({ isLoading: true });

    // When: the section renders.
    const { rerender } = render(<TunnelsSection />);

    // Then: loading and tip text are shown.
    expect(screen.getByText('Loading tunnels...')).toBeInTheDocument();
    expect(screen.getByText(tipText)).toBeInTheDocument();

    // Given: loading completed with no tunnel-eligible hosts.
    useTunnelsStore.setState({ isLoading: false, tunnels: [] });
    rerender(<TunnelsSection />);

    // Then: empty state keeps the tip visible.
    expect(screen.getByText('No tunnels configured in ~/.ssh/config')).toBeInTheDocument();
    expect(screen.getByText(tipText)).toBeInTheDocument();

    // Given: tunnel loading failed.
    useTunnelsStore.setState({ error: 'cannot list tunnels' });
    rerender(<TunnelsSection />);

    // Then: the error and retry control are shown with the tip.
    expect(screen.getByText('cannot list tunnels')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText(tipText)).toBeInTheDocument();
  });

  it('reloads SSH hosts before loading tunnels', async () => {
    // Given: host reload is intentionally delayed.
    let resolveReload: () => void = () => undefined;
    const reloadHosts = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReload = resolve;
        }),
    );
    const loadTunnels = vi.fn(() => Promise.resolve());
    useConnectionsStore.setState({ reloadHosts });
    useTunnelsStore.setState({ loadTunnels });
    render(<TunnelsSection />);

    // When: the user clicks the tunnel reload button.
    fireEvent.click(screen.getByRole('button', { name: 'Reload tunnels' }));

    // Then: tunnels are not loaded until SSH config reload has completed.
    expect(reloadHosts).toHaveBeenCalledOnce();
    expect(loadTunnels).not.toHaveBeenCalled();

    resolveReload();
    await waitFor(() => {
      expect(loadTunnels).toHaveBeenCalledOnce();
    });
  });

  it('disables tunnel reload while either host or tunnel loading is active', () => {
    // Given: SSH host loading is active.
    useConnectionsStore.setState({ isLoading: true });

    // When: the section renders.
    const { rerender } = render(<TunnelsSection />);

    // Then: the reload button is disabled.
    expect(screen.getByRole('button', { name: 'Reload tunnels' })).toBeDisabled();

    // Given: tunnel loading is active instead.
    useConnectionsStore.setState({ isLoading: false });
    useTunnelsStore.setState({ isLoading: true });
    rerender(<TunnelsSection />);

    // Then: the reload button remains disabled.
    expect(screen.getByRole('button', { name: 'Reload tunnels' })).toBeDisabled();
  });

  it('temporarily disables a lifecycle button after click', async () => {
    // Given: a stopped tunnel can be started.
    vi.useFakeTimers();
    const startTunnel = vi.fn(() => Promise.resolve());
    useTunnelsStore.setState({ tunnels: [stoppedTunnel], startTunnel });
    render(<TunnelsSection />);
    const row = screen.getByText('db-tunnel').closest('div');
    expect(row).not.toBeNull();
    const startButton = within(row as HTMLElement).getByRole('button', { name: /Start/ });

    // When: the user clicks Start.
    fireEvent.click(startButton);

    // Then: the button is busy briefly to prevent repeated clicks.
    expect(startButton).toBeDisabled();
    expect(startButton).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(startButton).not.toBeDisabled();
    vi.useRealTimers();
  });
});
