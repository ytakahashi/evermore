import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../stores/uiStore';
import { Sidebar } from './Sidebar';

vi.mock('../sidebar/WorkspacesView', () => ({
  WorkspacesView: () => <div>Workspace view mock</div>,
}));

vi.mock('../sidebar/ConnectionsView', () => ({
  ConnectionsView: () => <div>Connections view mock</div>,
}));

describe('Sidebar', () => {
  afterEach(() => {
    useUiStore.setState({ sidebarView: 'workspaces' });
  });

  it('renders the workspaces view by default', () => {
    // Given: the sidebar store is in its initial state.

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: workspace content is visible and connections content is not.
    expect(screen.getByText('Workspace view mock')).toBeInTheDocument();
    expect(screen.queryByText('Connections view mock')).not.toBeInTheDocument();
  });

  it('renders the connections view when selected', () => {
    // Given: the connections view has been selected.
    useUiStore.setState({ sidebarView: 'connections' });

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: connections content is visible and workspace content is not.
    expect(screen.getByText('Connections view mock')).toBeInTheDocument();
    expect(screen.queryByText('Workspace view mock')).not.toBeInTheDocument();
  });
});
