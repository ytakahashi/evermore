import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../../stores/uiStore';
import { AppShell } from './AppShell';

vi.mock('../main-area/MainTerminalArea', () => ({
  MainTerminalArea: () => <div data-testid="workspace-pane">workspace</div>,
}));

vi.mock('../settings/SettingsView', () => ({
  SettingsView: () => <div data-testid="settings-pane">settings</div>,
}));

vi.mock('./Sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('./TopBar', () => ({
  TopBar: () => <div data-testid="topbar" />,
}));

describe('AppShell', () => {
  beforeEach(() => {
    useUiStore.setState({ activeView: 'workspace' });
  });

  afterEach(() => {
    useUiStore.setState({ activeView: 'workspace' });
  });

  it('mounts both the workspace and settings panes simultaneously', () => {
    // Given: the workspace view is active.

    // When: the shell renders.
    render(<AppShell />);

    // Then: both subtrees are in the DOM, even though only one is visible. This is the property
    // that lets PTYs survive open/close transitions.
    expect(screen.getByTestId('workspace-pane')).toBeInTheDocument();
    expect(screen.getByTestId('settings-pane')).toBeInTheDocument();
  });

  it('opens the settings view when Cmd+, is pressed and is idempotent', () => {
    // Given: the user is on the workspace view.
    render(<AppShell />);

    // When: Cmd+, is pressed.
    fireEvent.keyDown(window, { key: ',', metaKey: true });

    // Then: the active view flips to settings.
    expect(useUiStore.getState().activeView).toBe('settings');

    // When: Cmd+, is pressed again while already on settings.
    fireEvent.keyDown(window, { key: ',', metaKey: true });

    // Then: it remains a no-op (matches macOS System Settings behavior).
    expect(useUiStore.getState().activeView).toBe('settings');
  });

  it('also accepts Ctrl+, on platforms where Cmd is not available', () => {
    // Given: the user is on the workspace view.
    render(<AppShell />);

    // When: Ctrl+, is pressed (CommandOrControl).
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });

    // Then: settings opens.
    expect(useUiStore.getState().activeView).toBe('settings');
  });

  it('closes the settings view when Esc is pressed', () => {
    // Given: the user is on the settings view.
    useUiStore.setState({ activeView: 'settings' });
    render(<AppShell />);

    // When: Esc is pressed.
    fireEvent.keyDown(window, { key: 'Escape' });

    // Then: the active view returns to workspace.
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('does not interfere with Esc when the workspace view is active', () => {
    // Given: a separate Esc listener installed by another component (representing
    // MainTerminalArea fullscreen handling) that should still observe the event.
    const otherListener = vi.fn();
    window.addEventListener('keydown', otherListener);
    render(<AppShell />);

    // When: Esc is pressed on the workspace view.
    fireEvent.keyDown(window, { key: 'Escape' });

    // Then: AppShell does not preventDefault when settings is closed, so the event still
    // propagates to siblings.
    expect(otherListener).toHaveBeenCalled();
    expect(useUiStore.getState().activeView).toBe('workspace');

    window.removeEventListener('keydown', otherListener);
  });
});
