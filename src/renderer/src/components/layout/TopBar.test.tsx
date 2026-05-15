import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useTunnelsStore } from '../../stores/tunnelsStore';
import { SIDEBAR_DEFAULT_WIDTH, useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TopBar } from './TopBar';

const workspace1: Workspace = {
  id: 'workspace-1',
  name: 'My Project',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'workspace-1-tab-1',
      name: 'zsh',
      layout: { type: 'leaf', paneId: 'workspace-1-pane-1' },
      activePaneId: 'workspace-1-pane-1',
    },
  ],
  panes: [{ id: 'workspace-1-pane-1', cwd: '/Users/tester' }],
  activeTabId: 'workspace-1-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

const workspace2: Workspace = {
  id: 'workspace-2',
  name: 'Side Work',
  rootPath: '/Users/tester/side',
  tabs: [
    {
      id: 'workspace-2-tab-1',
      name: 'zsh',
      layout: { type: 'leaf', paneId: 'workspace-2-pane-1' },
      activePaneId: 'workspace-2-pane-1',
    },
  ],
  panes: [{ id: 'workspace-2-pane-1', cwd: '/Users/tester/side' }],
  activeTabId: 'workspace-2-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

describe('TopBar', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: workspace1.id,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
    useTunnelsStore.setState({
      tunnels: [],
      isLoading: false,
      error: null,
    });
    useUiStore.setState({
      windowFullScreen: false,
      sidebarView: 'workspaces',
      sidebarOpen: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      tabBarOpen: false,
    });
  });

  it('renders the sidebar toggle button and toggles state on click', () => {
    // Given: the sidebar is open.
    useUiStore.setState({ sidebarOpen: true });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the close sidebar button is visible.
    const toggleButton = screen.getByRole('button', { name: 'Close sidebar' });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('title', 'Close sidebar');

    // When: the toggle button is clicked.
    fireEvent.click(toggleButton);

    // Then: the sidebar state is set to closed and the button changes.
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();

    // When: the toggle button is clicked again.
    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    // Then: the sidebar state is set back to open.
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Close sidebar' })).toBeInTheDocument();
  });

  it('renders the tab bar toggle button and toggles state on click', () => {
    // Given: the tab bar is closed by default.
    useUiStore.setState({ tabBarOpen: false });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the show tabs button is visible.
    const toggleButton = screen.getByRole('button', { name: 'Show tabs' });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('title', 'Show tabs');

    // When: the toggle button is clicked.
    fireEvent.click(toggleButton);

    // Then: the tab bar state is set to open and the button changes.
    expect(useUiStore.getState().tabBarOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide tabs' })).toBeInTheDocument();

    // When: the toggle button is clicked again.
    fireEvent.click(screen.getByRole('button', { name: 'Hide tabs' }));

    // Then: the tab bar state is set back to closed.
    expect(useUiStore.getState().tabBarOpen).toBe(false);
    expect(screen.getByRole('button', { name: 'Show tabs' })).toBeInTheDocument();
  });

  it('displays the active workspace name', () => {
    // Given: the first workspace is active.

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the active workspace name is shown.
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('updates the displayed name when the active workspace changes', () => {
    // Given: the top bar is rendered with the first workspace active.
    render(<TopBar />);

    // When: the second workspace becomes active.
    act(() => {
      useWorkspaceStore.setState({ activeWorkspaceId: workspace2.id });
    });

    // Then: the top bar reflects the new active workspace name.
    expect(screen.getByText('Side Work')).toBeInTheDocument();
    expect(screen.queryByText('My Project')).not.toBeInTheDocument();
  });

  it('renders an empty name when no workspace is loaded', () => {
    // Given: no workspaces are loaded.
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the name area is empty without throwing.
    expect(screen.queryByText('My Project')).not.toBeInTheDocument();
  });

  it('does not render a tunnel badge when no tunnels are active or failed', () => {
    // Given: no running or failed tunnels exist.

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the drag area remains free of tunnel controls.
    expect(screen.queryByText(/Tunnels:/)).not.toBeInTheDocument();
  });

  it('renders the running tunnel count', () => {
    // Given: one tunnel is running.
    useTunnelsStore.setState({
      tunnels: [
        {
          alias: 'dev',
          forwards: [],
          status: 'running',
          recentLogs: [],
        },
      ],
    });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the running count is visible.
    expect(screen.getByRole('button', { name: 'Tunnels: 1 running' })).toBeInTheDocument();
  });

  it('renders the error tunnel count alone', () => {
    // Given: one tunnel has failed and none are running.
    useTunnelsStore.setState({
      tunnels: [
        {
          alias: 'failed',
          forwards: [],
          status: 'error',
          recentLogs: [],
        },
      ],
    });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: the error count is visible without a running segment.
    expect(screen.getByRole('button', { name: 'Tunnels: 1 error' })).toBeInTheDocument();
  });

  it('renders error count before running count when both are present', () => {
    // Given: the tunnel list has one failure and one running tunnel.
    useTunnelsStore.setState({
      tunnels: [
        {
          alias: 'failed',
          forwards: [],
          status: 'error',
          recentLogs: [],
        },
        {
          alias: 'running',
          forwards: [],
          status: 'running',
          recentLogs: [],
        },
      ],
    });

    // When: the top bar renders.
    render(<TopBar />);

    // Then: error state is surfaced first.
    expect(screen.getByRole('button', { name: 'Tunnels: 1 error, 1 running' })).toBeInTheDocument();
  });

  it('opens the connections sidebar when the tunnel badge is clicked', () => {
    // Given: a visible tunnel badge, the workspace view is selected, and the sidebar is closed.
    useUiStore.setState({ sidebarView: 'workspaces', sidebarOpen: false });
    useTunnelsStore.setState({
      tunnels: [
        {
          alias: 'failed',
          forwards: [],
          status: 'error',
          recentLogs: [],
        },
      ],
    });
    render(<TopBar />);

    // When: the user clicks the tunnel badge.
    fireEvent.click(screen.getByRole('button', { name: 'Tunnels: 1 error' }));

    // Then: the connections sidebar view is selected.
    expect(useUiStore.getState().sidebarView).toBe('connections');
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it('does not render when the window is in fullscreen', () => {
    // Given: the window is in fullscreen.
    useUiStore.setState({ windowFullScreen: true });

    // When: the top bar renders.
    const { container } = render(<TopBar />);

    // Then: the component returns null (empty container).
    expect(container.firstChild).toBeNull();
  });
});
