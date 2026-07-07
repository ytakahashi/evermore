import { afterEach, describe, expect, it } from 'vitest';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useUiStore } from './uiStore';

describe('useUiStore', () => {
  afterEach(() => {
    useUiStore.setState({
      fullscreenPaneId: null,
      sidebarView: 'workspaces',
      sidebarOpen: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      activeView: 'workspace',
      tabSearchOpen: false,
    });
  });

  it('defaults to the workspaces sidebar view and open sidebar with default width', () => {
    // Given: the UI store has just been created.

    // When: callers read the initial state.
    const state = useUiStore.getState();

    // Then: the workspaces view is selected and sidebar is open with default width.
    expect(state.sidebarView).toBe('workspaces');
    expect(state.sidebarOpen).toBe(true);
    expect(state.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(state.fullscreenPaneId).toBeNull();
    expect(state.activeView).toBe('workspace');
    expect(state.tabSearchOpen).toBe(false);
  });

  it('opens and closes the settings view through dedicated actions', () => {
    // Given: the workspace view is active by default.

    // When: settings is opened.
    useUiStore.getState().openSettings();

    // Then: the active view flips to settings.
    expect(useUiStore.getState().activeView).toBe('settings');

    // When: openSettings is called again while already on settings.
    useUiStore.getState().openSettings();

    // Then: it remains a no-op (idempotent), matching the Mac System Settings behavior.
    expect(useUiStore.getState().activeView).toBe('settings');

    // When: settings is closed.
    useUiStore.getState().closeSettings();

    // Then: the active view returns to workspace.
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('returns to workspace when the user clicks a sidebar view while settings is active', () => {
    // Given: the user is on the SettingsView.
    useUiStore.getState().openSettings();
    expect(useUiStore.getState().activeView).toBe('settings');

    // When: the user clicks a sidebar view button (workspaces / connections).
    useUiStore.getState().setSidebarView('connections');

    // Then: the sidebar view follows the click and the active view goes back to workspace.
    expect(useUiStore.getState().sidebarView).toBe('connections');
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('does not bounce activeView when setSidebarView is called inside the workspace view', () => {
    // Given: the user is already on the workspace view.

    // When: the user switches sidebar views (which does not affect main pane visibility).
    useUiStore.getState().setSidebarView('connections');

    // Then: activeView remains workspace (no spurious transitions).
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('sets and clears the fullscreen pane id', () => {
    // Given: no pane is fullscreen initially.

    // When: callers set a fullscreen pane and then clear it.
    useUiStore.getState().setFullscreenPaneId('pane-1');
    expect(useUiStore.getState().fullscreenPaneId).toBe('pane-1');
    useUiStore.getState().clearFullscreen();

    // Then: fullscreen state returns to its transient default.
    expect(useUiStore.getState().fullscreenPaneId).toBeNull();
  });

  it('opens and closes the tab search palette through dedicated actions', () => {
    // Given: the tab search palette is closed by default.
    expect(useUiStore.getState().tabSearchOpen).toBe(false);

    // When: callers open the tab search palette.
    useUiStore.getState().openTabSearch();

    // Then: the palette open state is set.
    expect(useUiStore.getState().tabSearchOpen).toBe(true);

    // When: callers close the tab search palette.
    useUiStore.getState().closeTabSearch();

    // Then: the palette returns to its closed state.
    expect(useUiStore.getState().tabSearchOpen).toBe(false);
  });

  it('updates the active sidebar view', () => {
    // Given: the default workspaces view is selected.

    // When: the user selects the connections view and then returns to workspaces.
    useUiStore.getState().setSidebarView('connections');
    expect(useUiStore.getState().sidebarView).toBe('connections');
    useUiStore.getState().setSidebarView('workspaces');

    // Then: the selected view follows the latest action.
    expect(useUiStore.getState().sidebarView).toBe('workspaces');
  });

  it('toggles the sidebar open state without affecting width', () => {
    // Given: the sidebar is open and has a custom width.
    useUiStore.getState().setSidebarWidth(300);

    // When: the sidebar is toggled.
    useUiStore.getState().toggleSidebar();

    // Then: the sidebar is closed and width is retained.
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(useUiStore.getState().sidebarWidth).toBe(300);

    // When: the sidebar is toggled again.
    useUiStore.getState().toggleSidebar();

    // Then: the sidebar is open and width is retained.
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(useUiStore.getState().sidebarWidth).toBe(300);
  });

  it('sets the sidebar open state explicitly without affecting width', () => {
    // Given: the sidebar is open and has a custom width.
    useUiStore.getState().setSidebarWidth(320);

    // When: the sidebar open state is explicitly set to false.
    useUiStore.getState().setSidebarOpen(false);

    // Then: the sidebar is closed and width is retained.
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    expect(useUiStore.getState().sidebarWidth).toBe(320);
  });

  it('sets the sidebar width within the allowed range', () => {
    // Given: the default sidebar width.

    // When: the sidebar width is set to a valid value within the range.
    useUiStore.getState().setSidebarWidth(300);

    // Then: the sidebar width is updated.
    expect(useUiStore.getState().sidebarWidth).toBe(300);
  });

  it('clamps the sidebar width to the minimum allowed value', () => {
    // Given: the default sidebar width.

    // When: the sidebar width is set below the minimum value.
    useUiStore.getState().setSidebarWidth(50);
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);

    // When: the sidebar width is set to 0.
    useUiStore.getState().setSidebarWidth(0);

    // Then: the sidebar width remains clamped to the minimum value.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('clamps the sidebar width to the maximum allowed value', () => {
    // Given: the default sidebar width.

    // When: the sidebar width is set above the maximum value.
    useUiStore.getState().setSidebarWidth(1000);

    // Then: the sidebar width is clamped to the maximum value.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('falls back to the default width if the provided width is NaN or Infinity', () => {
    // Given: the sidebar has a custom width.
    useUiStore.getState().setSidebarWidth(300);

    // When: the sidebar width is set to NaN.
    useUiStore.getState().setSidebarWidth(Number.NaN);

    // Then: the sidebar width falls back to the default.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);

    // When: the sidebar width is set to Infinity.
    useUiStore.getState().setSidebarWidth(300);
    useUiStore.getState().setSidebarWidth(Number.POSITIVE_INFINITY);

    // Then: the sidebar width falls back to the default.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
