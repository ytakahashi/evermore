import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SSHHost } from '../../../../shared/types';
import { useConnectionsStore } from '../../stores/connectionsStore';
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
    useWorkspaceStore.setState(initialWorkspaceState);
  });

  it('renders host rows with detail text and forwarding badges', () => {
    // Given: SSH hosts have been loaded from config.
    useConnectionsStore.setState({ hosts });

    // When: the hosts section renders.
    render(<SSHHostsSection />);

    // Then: host aliases, connection details, and forwarding status are visible.
    expect(screen.getByRole('button', { name: /dev/ })).toHaveTextContent('dev');
    expect(screen.getByText('deploy@dev.example.com:2222')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /db-tunnel/ })).toHaveTextContent('fwd');
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
    const row = screen.getByRole('button', { name: /bare/ });
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

  it('reloads hosts from the section header and disables reload while loading', async () => {
    // Given: the store has a reload action.
    const reloadHosts = vi.fn(() => Promise.resolve());
    useConnectionsStore.setState({ reloadHosts });
    render(<SSHHostsSection />);

    // When: the user clicks the reload button.
    const reloadButton = screen.getByRole('button', { name: 'Reload SSH hosts' });
    fireEvent.click(reloadButton);

    // Then: the reload action runs.
    expect(reloadHosts).toHaveBeenCalledOnce();

    // When: loading starts.
    useConnectionsStore.setState({ isLoading: true });

    // Then: reload is disabled until the request settles.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reload SSH hosts' })).toBeDisabled();
    });
  });

  it('opens a host tab when a host row is clicked', () => {
    // Given: SSH hosts are listed and the workspace store can open an SSH tab.
    const openSshHostTab = vi.fn();
    useConnectionsStore.setState({ hosts });
    useWorkspaceStore.setState({ openSshHostTab });

    // When: the user clicks a host row.
    render(<SSHHostsSection />);
    fireEvent.click(screen.getByRole('button', { name: /dev/ }));

    // Then: the host alias is passed to the workspace action.
    expect(openSshHostTab).toHaveBeenCalledWith('dev');
  });
});
