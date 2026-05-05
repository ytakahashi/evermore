import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../stores/uiStore';
import { SidebarBottomNav } from './SidebarBottomNav';

describe('SidebarBottomNav', () => {
  afterEach(() => {
    useUiStore.setState({ sidebarView: 'workspaces' });
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

  it('leaves settings disabled for the later settings phase', () => {
    // Given: the bottom navigation is visible.
    render(<SidebarBottomNav />);

    // When: the Settings control is inspected.
    const settingsButton = screen.getByRole('button', { name: 'Settings' });

    // Then: it is not interactive in Phase 2.
    expect(settingsButton).toBeDisabled();
  });
});
