import { collectPaneIds } from '../../../shared/pane-layout';
import { DEFAULT_APP_SETTINGS } from '../../../shared/settings-defaults';
import type { ConfirmMode, PaneRuntimeInfo } from '../../../shared/types';
import { usePaneInfoStore } from '../stores/paneInfoStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../stores/workspaceStore';

/**
 * Returns whether any supplied PTY currently owns a running foreground process.
 */
export function hasRunningPty(
  ptyIds: readonly (string | undefined)[],
  infosByPtyId: Readonly<Record<string, PaneRuntimeInfo>>,
): boolean {
  return ptyIds.some(
    (ptyId) => ptyId !== undefined && infosByPtyId[ptyId]?.processActivity === 'running',
  );
}

/**
 * Returns whether the configured policy requires confirmation for a tab close.
 *
 * SSH tunnels are deliberately excluded because they are app-wide resources and closing a tab
 * does not stop them. Quit confirmation remains responsible for protecting active tunnels.
 */
export function shouldConfirmTabClose(options: {
  mode: ConfirmMode;
  runningProcesses: boolean;
}): boolean {
  if (options.mode === 'never') {
    return false;
  }
  if (options.mode === 'always') {
    return true;
  }
  return options.runningProcesses;
}

type TabCloseWorkspaceState = Pick<WorkspaceStoreState, 'workspaces' | 'closeWorkspaceTab'>;

export interface TabCloseRequesterDeps {
  confirmCloseTab: (payload: { runningProcesses: boolean }) => Promise<boolean>;
  getMode: () => ConfirmMode;
  getPaneInfos: () => Readonly<Record<string, PaneRuntimeInfo>>;
  getWorkspaceState: () => TabCloseWorkspaceState;
}

/**
 * Creates the user-initiated tab-close coordinator with injectable stores and native dialog API.
 */
export function createTabCloseRequester(
  deps: TabCloseRequesterDeps,
): (workspaceId: string, tabId: string) => Promise<void> {
  const inFlightTabIds = new Set<string>();

  return async (workspaceId: string, tabId: string): Promise<void> => {
    const state = deps.getWorkspaceState();
    const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
    const tab = workspace?.tabs.find((candidate) => candidate.id === tabId);
    if (!workspace || !tab || workspace.tabs.length <= 1) {
      return;
    }
    // Check before reading runtime activity: a prompt already in flight must keep owning the tab
    // even if its process transitions from running to idle while the native sheet is open.
    if (inFlightTabIds.has(tabId)) {
      return;
    }

    const panesById = new Map(workspace.panes.map((pane) => [pane.id, pane]));
    const ptyIds = collectPaneIds(tab.layout).map((paneId) => panesById.get(paneId)?.ptyId);
    const infosByPtyId = deps.getPaneInfos();
    const runningProcesses = hasRunningPty(ptyIds, infosByPtyId);
    if (!shouldConfirmTabClose({ mode: deps.getMode(), runningProcesses })) {
      state.closeWorkspaceTab(workspaceId, tabId);
      return;
    }

    inFlightTabIds.add(tabId);

    try {
      const confirmed = await deps.confirmCloseTab({ runningProcesses });
      if (!confirmed) {
        return;
      }

      // Native sheets yield control back to the renderer. Re-read structural state before the
      // destructive mutation because an automatic PTY-exit close may have settled in the interim.
      const latestState = deps.getWorkspaceState();
      const latestWorkspace = latestState.workspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (
        !latestWorkspace ||
        latestWorkspace.tabs.length <= 1 ||
        !latestWorkspace.tabs.some((candidate) => candidate.id === tabId)
      ) {
        return;
      }

      latestState.closeWorkspaceTab(workspaceId, tabId);
    } catch (_error: unknown) {
      // A failed confirmation cannot safely authorize a destructive close; let the user retry.
    } finally {
      inFlightTabIds.delete(tabId);
    }
  };
}

/** Production tab-close requester wired to renderer singleton stores and the preload API. */
export const requestTabClose = createTabCloseRequester({
  confirmCloseTab: (payload) => window.api.window.confirmCloseTab(payload),
  getMode: () =>
    useSettingsStore.getState().settings?.app.tabCloseConfirm ??
    DEFAULT_APP_SETTINGS.app.tabCloseConfirm,
  getPaneInfos: () => usePaneInfoStore.getState().infosByPtyId,
  getWorkspaceState: () => useWorkspaceStore.getState(),
});
