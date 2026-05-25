import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardShortcutActionId } from '../../../shared/keyboard-shortcuts';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useShortcutBridge } from './useShortcutBridge';

function TestBridge(): React.JSX.Element {
  useShortcutBridge();
  return <div>bridge</div>;
}

describe('useShortcutBridge', () => {
  let onInvokeListeners: Array<(actionId: KeyboardShortcutActionId) => void>;
  let unsubscribe: ReturnType<typeof vi.fn>;

  function emit(actionId: KeyboardShortcutActionId): void {
    for (const listener of onInvokeListeners) {
      listener(actionId);
    }
  }

  beforeEach(() => {
    onInvokeListeners = [];
    unsubscribe = vi.fn();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        shortcuts: {
          onInvoke: vi.fn((cb: (actionId: KeyboardShortcutActionId) => void) => {
            onInvokeListeners.push(cb);
            return unsubscribe;
          }),
        },
      } as unknown as Window['api'],
    });
    // Reset transient ui state that other tests may have left behind.
    useUiStore.setState({ activeView: 'workspace', fullscreenPaneId: null, sidebarOpen: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
  });

  it('dispatches workspace.newTab to the workspace store addTab action', () => {
    // Given: the workspace store action is replaced with a spy so we do not depend on store
    // internals having an active workspace loaded.
    const addTab = vi.fn();
    const previousAddTab = useWorkspaceStore.getState().addTab;
    useWorkspaceStore.setState({ addTab });
    render(<TestBridge />);

    // When: the main process invokes the new-tab action.
    emit('workspace.newTab');

    // Then: the bridge forwards the call to the store.
    expect(addTab).toHaveBeenCalledOnce();
    useWorkspaceStore.setState({ addTab: previousAddTab });
  });

  it('toggles the sidebar even while the Settings view is active', () => {
    // Given: the Settings view is open and the sidebar is currently open.
    useUiStore.setState({ activeView: 'settings', sidebarOpen: true });
    render(<TestBridge />);

    // When: the toggle-sidebar action fires.
    emit('ui.toggleSidebar');

    // Then: the chrome action still flips the sidebar state.
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it('skips workspace.newTab while the Settings view is active', () => {
    // Given: a spy addTab and the Settings view active.
    const addTab = vi.fn();
    const previousAddTab = useWorkspaceStore.getState().addTab;
    useWorkspaceStore.setState({ addTab });
    useUiStore.setState({ activeView: 'settings' });
    render(<TestBridge />);

    // When: the new-tab action fires while settings is up.
    emit('workspace.newTab');

    // Then: the bridge swallows it so stray Cmd+T does not create tabs the user cannot see.
    expect(addTab).not.toHaveBeenCalled();
    useWorkspaceStore.setState({ addTab: previousAddTab });
  });

  it('splits the active pane only when no pane is in fullscreen', () => {
    // Given: a spy splitActivePane that we can observe.
    const splitActivePane = vi.fn();
    const previous = useWorkspaceStore.getState().splitActivePane;
    useWorkspaceStore.setState({ splitActivePane });
    render(<TestBridge />);

    // When: the split fires while fullscreen is engaged.
    useUiStore.setState({ fullscreenPaneId: 'pane-x' });
    emit('pane.splitVertical');
    expect(splitActivePane).not.toHaveBeenCalled();

    // Then: clearing fullscreen lets the next invocation through.
    useUiStore.setState({ fullscreenPaneId: null });
    emit('pane.splitVertical');
    expect(splitActivePane).toHaveBeenCalledWith('vertical');
    useWorkspaceStore.setState({ splitActivePane: previous });
  });

  it('opens settings via ui.openSettings regardless of current view', () => {
    // Given: the workspace view is active.
    useUiStore.setState({ activeView: 'workspace' });
    render(<TestBridge />);

    // When: the open-settings action fires.
    emit('ui.openSettings');

    // Then: the Settings view comes up.
    expect(useUiStore.getState().activeView).toBe('settings');
  });

  it('unsubscribes from window.api.shortcuts.onInvoke on unmount', () => {
    // Given: the bridge has been mounted.
    const view = render(<TestBridge />);

    // When: the host component unmounts.
    view.unmount();

    // Then: the cleanup returned by onInvoke runs.
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
