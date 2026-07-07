import { useEffect } from 'react';
import type { KeyboardShortcutActionId } from '../../../shared/keyboard-shortcuts';
import { useUiStore } from '../stores/uiStore';
import { selectActivePane, useWorkspaceStore } from '../stores/workspaceStore';

/**
 * Subscribes to shortcut invocations dispatched from the main-process application menu and
 * forwards each `actionId` to the matching renderer store action.
 *
 * The application menu owns accelerator → action resolution; this hook is the only place that
 * turns those invocations into store mutations. The switch is `exhaustive`: adding a new
 * `KeyboardShortcutActionId` without handling it here is a TypeScript error via the
 * `never` assertion in the default branch.
 *
 * Context guards:
 *  - `workspace.*` and `pane.*` actions are no-ops while the Settings view is active so a stray
 *    `Cmd+T` does not silently create tabs the user cannot see.
 *  - `pane.split*` and `pane.focus*` are no-ops while a pane is in fullscreen so the layout cannot
 *    mutate underneath the focused pane.
 *  - `pane.toggleFullscreen` runs in either fullscreen state (that is the toggle), but is still
 *    gated to the workspace view so it does not silently affect a hidden tab.
 *  - `ui.toggleSidebar` and `ui.openSettings` are always allowed — they only affect chrome.
 */
export function useShortcutBridge(): void {
  useEffect(() => {
    const unsubscribe = window.api.shortcuts.onInvoke((actionId) => {
      handleShortcut(actionId);
    });
    return unsubscribe;
  }, []);
}

function handleShortcut(actionId: KeyboardShortcutActionId): void {
  const uiState = useUiStore.getState();
  const isWorkspaceView = uiState.activeView === 'workspace';
  const isFullscreen = uiState.fullscreenPaneId !== null;
  const workspace = useWorkspaceStore.getState();

  switch (actionId) {
    case 'workspace.newTab':
      if (!isWorkspaceView) return;
      workspace.addTab();
      return;
    case 'workspace.closeTab':
      if (!isWorkspaceView) return;
      workspace.closeActiveTab();
      return;
    case 'workspace.nextTab':
      if (!isWorkspaceView) return;
      workspace.selectAdjacentTab('next');
      return;
    case 'workspace.previousTab':
      if (!isWorkspaceView) return;
      workspace.selectAdjacentTab('previous');
      return;
    case 'workspace.nextTabGlobal':
      if (!isWorkspaceView) return;
      workspace.selectAdjacentTabGlobal('next');
      return;
    case 'workspace.previousTabGlobal':
      if (!isWorkspaceView) return;
      workspace.selectAdjacentTabGlobal('previous');
      return;
    case 'pane.splitVertical':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.splitActivePane('vertical');
      return;
    case 'pane.splitHorizontal':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.splitActivePane('horizontal');
      return;
    case 'pane.focusLeft':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.focusAdjacentPane('left');
      return;
    case 'pane.focusRight':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.focusAdjacentPane('right');
      return;
    case 'pane.focusUp':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.focusAdjacentPane('up');
      return;
    case 'pane.focusDown':
      if (!isWorkspaceView || isFullscreen) return;
      workspace.focusAdjacentPane('down');
      return;
    case 'pane.toggleFullscreen': {
      if (!isWorkspaceView) return;
      if (isFullscreen) {
        uiState.clearFullscreen();
        return;
      }
      const activePane = selectActivePane(workspace);
      if (!activePane) return;
      uiState.setFullscreenPaneId(activePane.id);
      return;
    }
    case 'ui.openTabSearch':
      uiState.openTabSearch();
      return;
    case 'ui.toggleSidebar':
      uiState.toggleSidebar();
      return;
    case 'ui.openSettings':
      uiState.openSettings();
      return;
    default: {
      const _exhaustive: never = actionId;
      return _exhaustive;
    }
  }
}
