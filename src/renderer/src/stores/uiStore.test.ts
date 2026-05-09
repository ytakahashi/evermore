import { afterEach, describe, expect, it } from 'vitest';
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, useUiStore } from './uiStore';

describe('useUiStore', () => {
  afterEach(() => {
    useUiStore.setState({
      fullscreenPaneId: null,
      sidebarView: 'workspaces',
      sidebarOpen: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
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
