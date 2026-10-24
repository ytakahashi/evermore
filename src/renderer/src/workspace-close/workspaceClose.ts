import { DEFAULT_APP_SETTINGS } from '../../../shared/settings-defaults';
import type { ConfirmMode, PaneRuntimeInfo } from '../../../shared/types';
import { canCloseWorkspace } from '../../../shared/workspace-kind';
import { usePaneInfoStore } from '../stores/paneInfoStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../stores/workspaceStore';
import { hasRunningPty, shouldConfirmTerminalClose } from '../terminal-close/closePolicy';

export interface WorkspaceCloseRequesterDeps {
  confirmCloseWorkspace: (payload: { runningProcesses: boolean }) => Promise<boolean>;
  getMode: () => ConfirmMode;
  getPaneInfos: () => Readonly<Record<string, PaneRuntimeInfo>>;
  getWorkspaceState: () => Pick<WorkspaceStoreState, 'workspaces' | 'closeWorkspace'>;
}

/** Coordinates user-initiated workspace closes with one confirmation for all owned terminals. */
export function createWorkspaceCloseRequester(
  deps: WorkspaceCloseRequesterDeps,
): (workspaceId: string) => Promise<void> {
  const inFlightWorkspaceIds = new Set<string>();
  return async (workspaceId) => {
    const state = deps.getWorkspaceState();
    const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
    // Pending consent still owns this target even if activity becomes idle during the sheet.
    if (!workspace || !canCloseWorkspace(workspace) || inFlightWorkspaceIds.has(workspaceId)) {
      return;
    }
    const runningProcesses = hasRunningPty(
      workspace.panes.map((pane) => pane.ptyId),
      deps.getPaneInfos(),
    );
    if (!shouldConfirmTerminalClose({ mode: deps.getMode(), runningProcesses })) {
      state.closeWorkspace(workspaceId);
      return;
    }
    inFlightWorkspaceIds.add(workspaceId);
    try {
      if (!(await deps.confirmCloseWorkspace({ runningProcesses }))) return;
      // Native sheets yield; preserve edits and refuse targets already closed or deleted meanwhile.
      const latest = deps.getWorkspaceState();
      const target = latest.workspaces.find((candidate) => candidate.id === workspaceId);
      if (target && canCloseWorkspace(target)) latest.closeWorkspace(workspaceId);
    } catch (_error: unknown) {
      // A failed sheet cannot authorize stopping terminal sessions; the user may retry.
    } finally {
      inFlightWorkspaceIds.delete(workspaceId);
    }
  };
}

/** Production workspace-close requester wired to renderer stores and the native confirmation API. */
export const requestWorkspaceClose = createWorkspaceCloseRequester({
  confirmCloseWorkspace: (payload) => window.api.window.confirmCloseWorkspace(payload),
  getMode: () =>
    useSettingsStore.getState().settings?.app.tabCloseConfirm ??
    DEFAULT_APP_SETTINGS.app.tabCloseConfirm,
  getPaneInfos: () => usePaneInfoStore.getState().infosByPtyId,
  getWorkspaceState: () => useWorkspaceStore.getState(),
});
