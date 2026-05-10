import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../stores/uiStore';
import { SidebarBottomNav } from './SidebarBottomNav';

describe('SidebarBottomNav', () => {
  afterEach(() => {
    useUiStore.setState({ sidebarView: 'workspaces', activeView: 'workspace' });
  });

  it('marks the selected sidebar view as active', () => {
    // Given: the workspaces view is selected by default.

    // When: the bottom navigation renders.
    render(<SidebarBottomNav />);

    // Then: only Workspaces is marked as the current view.
    expect(screen.getByRole('button', { name: 'Workspaces' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Connections' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Settings' })).not.toHaveAttribute('aria-current');
  });

  it('switches between workspaces and connections', () => {
    // Given: the bottom navigation is visible.
    render(<SidebarBottomNav />);

    // When: the user switches to Connections and then back to Workspaces.
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
    expect(useUiStore.getState().sidebarView).toBe('connections');
    expect(screen.getByRole('button', { name: 'Connections' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    // Then: the active state follows the selected view.
    expect(useUiStore.getState().sidebarView).toBe('workspaces');
    expect(screen.getByRole('button', { name: 'Workspaces' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the settings view when the settings button is clicked', () => {
    // Given: the bottom navigation is visible and the user is on the workspace view.
    render(<SidebarBottomNav />);

    // When: the Settings control is clicked.
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    // Then: the active main-area view becomes settings.
    expect(useUiStore.getState().activeView).toBe('settings');
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark Workspaces / Connections as active while Settings is open', () => {
    // Given: settings is currently active.
    useUiStore.setState({ activeView: 'settings' });
    render(<SidebarBottomNav />);

    // When: the user inspects the sidebar buttons.
    const workspaces = screen.getByRole('button', { name: 'Workspaces' });
    const connections = screen.getByRole('button', { name: 'Connections' });
    const settings = screen.getByRole('button', { name: 'Settings' });

    // Then: only the Settings button is marked active so the user can see at a glance which
    // pane is up.
    expect(workspaces).not.toHaveAttribute('aria-current');
    expect(connections).not.toHaveAttribute('aria-current');
    expect(settings).toHaveAttribute('aria-current', 'page');
  });

  it('returns to the workspace view when a sidebar view button is clicked while settings is open', () => {
    // Given: the user is on the settings view.
    useUiStore.setState({ activeView: 'settings' });
    render(<SidebarBottomNav />);

    // When: the user clicks Workspaces.
    fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }));

    // Then: the sidebar view updates and the main pane returns to workspace.
    expect(useUiStore.getState().sidebarView).toBe('workspaces');
    expect(useUiStore.getState().activeView).toBe('workspace');
  });
});
