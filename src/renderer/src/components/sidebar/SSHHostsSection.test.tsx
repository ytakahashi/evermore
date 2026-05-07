import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SSHHost } from '../../../../shared/types';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useSshResolutionsStore } from '../../stores/sshResolutionsStore';
import { useTunnelsStore } from '../../stores/tunnelsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { SSHHostsSection } from './SSHHostsSection';

const hosts: SSHHost[] = [
  {
    alias: 'dev',
    hostname: 'dev.example.com',
    user: 'deploy',
    port: 2222,
    hasForwarding: false,
    forwards: [],
  },
  {
    alias: 'db-tunnel',
    hostname: 'bastion.example.com',
    hasForwarding: true,
    forwards: [
      {
        type: 'local',
        bindPort: 5433,
        hostAddress: 'localhost',
        hostPort: 5432,
      },
    ],
  },
];

const initialConnectionsState = useConnectionsStore.getState();
const initialTunnelsState = useTunnelsStore.getState();
const initialSshResolutionsState = useSshResolutionsStore.getState();
const initialWorkspaceState = useWorkspaceStore.getState();

describe('SSHHostsSection', () => {
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
    useWorkspaceStore.setState(initialWorkspaceState);
  });

  it('renders host rows with detail text and forwarding badges', () => {
    // Given: SSH hosts have been loaded from config.
    useConnectionsStore.setState({ hosts });

    // When: the hosts section renders.
    render(<SSHHostsSection />);

    // Then: host aliases, connection details, and forwarding status are visible.
    // We use expanded: false to target the expansion toggle button, distinguishing it from "Open ssh dev".
    expect(screen.getByRole('button', { name: /dev/, expanded: false })).toBeInTheDocument();
    expect(screen.getByText('deploy@dev.example.com:2222')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /db-tunnel/, expanded: false })).toHaveTextContent(
      'fwd',
    );
    expect(screen.getByText('bastion.example.com')).toBeInTheDocument();
  });

  it('omits the subtitle row for bare aliases without HostName / User / Port', () => {
    // Given: a Host block declares only the alias and nothing else.
    useConnectionsStore.setState({
      hosts: [
        {
          alias: 'bare',
          hasForwarding: false,
          forwards: [],
        },
      ],
    });

    // When: the hosts section renders.
    render(<SSHHostsSection />);

    // Then: the alias is shown exactly once, with no duplicated subtitle.
    const row = screen.getByRole('button', { name: /bare/, expanded: false });
    expect(row).toHaveTextContent('bare');
    expect(row.textContent?.match(/bare/g)?.length).toBe(1);
  });

  it('renders loading, empty, and error states', () => {
    // Given: host loading is in progress.
    useConnectionsStore.setState({ isLoading: true });

    // When: the section renders.
    const { rerender } = render(<SSHHostsSection />);

    // Then: the loading text is shown.
    expect(screen.getByText('Loading SSH hosts...')).toBeInTheDocument();

    // Given: loading completed with no hosts.
    useConnectionsStore.setState({ isLoading: false, hosts: [] });
    rerender(<SSHHostsSection />);

    // Then: the empty state is shown.
    expect(screen.getByText('No hosts found in ~/.ssh/config')).toBeInTheDocument();

    // Given: loading failed.
    useConnectionsStore.setState({ error: 'cannot read config' });
    rerender(<SSHHostsSection />);

    // Then: the error and retry control are shown.
    expect(screen.getByText('cannot read config')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reloads hosts before tunnels from the section header and disables reload while loading', async () => {
    // Given: the store has a reload action.
    const reloadHosts = vi.fn(() => Promise.resolve());
    const loadTunnels = vi.fn(() => Promise.resolve());
    useConnectionsStore.setState({ reloadHosts });
    useTunnelsStore.setState({ loadTunnels });
    render(<SSHHostsSection />);

    // When: the user clicks the reload button.
    const reloadButton = screen.getByRole('button', { name: 'Reload SSH hosts' });
    fireEvent.click(reloadButton);

    // Then: the reload action runs.
    expect(reloadHosts).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(loadTunnels).toHaveBeenCalledOnce();
    });

    // When: loading starts.
    useConnectionsStore.setState({ isLoading: true });

    // Then: reload is disabled until the request settles.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reload SSH hosts' })).toBeDisabled();
    });
  });

  it('expands a host row and resolves directives when clicked', () => {
    // Given: SSH hosts are listed and the resolutions store has a resolve action.
    useConnectionsStore.setState({ hosts });
    const resolveAlias = vi.fn(() => Promise.resolve());
    useSshResolutionsStore.setState({ resolveAlias });

    // When: the user clicks a host row's expansion toggle.
    render(<SSHHostsSection />);
    const expandButton = screen.getByRole('button', { name: /dev/, expanded: false });
    fireEvent.click(expandButton);

    // Then: the row is expanded and resolution is triggered.
    expect(expandButton).toHaveAttribute('aria-expanded', 'true');
    expect(resolveAlias).toHaveBeenCalledWith('dev');
  });

  it('renders resolved directives when ready', () => {
    // Given: a host is expanded and its resolution is ready.
    useConnectionsStore.setState({ hosts: [hosts[0]] });
    useSshResolutionsStore.setState({
      resolutions: {
        dev: {
          status: 'ready',
          data: {
            hostname: ['resolved.host'],
            user: ['resolved-user'],
            identityfile: ['~/.ssh/key1', '~/.ssh/key2'],
          },
        },
      },
    });

    // When: the hosts section renders with the host expanded.
    render(<SSHHostsSection />);
    fireEvent.click(screen.getByRole('button', { name: /dev/, expanded: false })); // toggle expand

    // Then: the resolved directives are visible.
    expect(screen.getByText('resolved.host')).toBeInTheDocument();
    expect(screen.getByText('resolved-user')).toBeInTheDocument();
    expect(screen.getByText('~/.ssh/key1')).toBeInTheDocument();
    expect(screen.getByText('~/.ssh/key2')).toBeInTheDocument();
  });

  it('renders error and retry button when resolution fails', () => {
    // Given: a host resolution failed.
    useConnectionsStore.setState({ hosts: [hosts[0]] });
    const resolveAlias = vi.fn();
    useSshResolutionsStore.setState({
      resolutions: {
        dev: {
          status: 'error',
          error: 'ssh -G failed',
        },
      },
      resolveAlias,
    });

    // When: the host is expanded.
    render(<SSHHostsSection />);
    fireEvent.click(screen.getByRole('button', { name: /dev/, expanded: false }));

    // Then: the error message and retry button are shown.
    expect(screen.getByText(/Error: ssh -G failed/)).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryButton);

    // Then: retry triggers a new resolution attempt.
    expect(resolveAlias).toHaveBeenCalledWith('dev');
  });

  it('re-resolves an expanded host when the resolution cache is cleared', async () => {
    // Given: a host is already expanded with a ready resolution.
    useConnectionsStore.setState({ hosts: [hosts[0]] });
    const resolveAlias = vi.fn(() => Promise.resolve());
    useSshResolutionsStore.setState({
      resolutions: {
        dev: {
          status: 'ready',
          data: { hostname: ['cached.host'] },
        },
      },
      resolveAlias,
    });
    render(<SSHHostsSection />);
    fireEvent.click(screen.getByRole('button', { name: /dev/, expanded: false }));

    // When: the resolution cache is cleared (e.g. after `useReloadConnections`).
    expect(resolveAlias).not.toHaveBeenCalled();
    useSshResolutionsStore.setState({ resolutions: {} });

    // Then: the still-expanded ResolutionDetail re-fetches via the mount effect.
    await waitFor(() => {
      expect(resolveAlias).toHaveBeenCalledWith('dev');
    });
  });

  it('opens a host tab when the Open button is clicked', () => {
    // Given: SSH hosts are listed and the workspace store can open an SSH tab.
    const openSshHostTab = vi.fn();
    useConnectionsStore.setState({ hosts });
    useWorkspaceStore.setState({ openSshHostTab });

    // When: the user clicks the Open button for a host.
    render(<SSHHostsSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Open ssh dev' }));

    // Then: the host alias is passed to the workspace action.
    expect(openSshHostTab).toHaveBeenCalledWith('dev');
  });
});
