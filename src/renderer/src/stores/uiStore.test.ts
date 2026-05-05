import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

describe('useUiStore', () => {
  afterEach(() => {
    useUiStore.setState({ sidebarView: 'workspaces' });
  });

  it('defaults to the workspaces sidebar view', () => {
    // Given: the UI store has just been created.

    // When: callers read the initial state.
    const state = useUiStore.getState();

    // Then: the workspaces view is selected.
    expect(state.sidebarView).toBe('workspaces');
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
});
