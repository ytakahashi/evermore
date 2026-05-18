import { useEffect, useRef } from 'react';
import { usePaneInfoStore } from '../stores/paneInfoStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

/**
 * Subscribes once to main-process pane runtime events and mirrors them into renderer state.
 *
 * The bridge owns the only place where `PaneRuntimeInfo` flows from main to renderer, so cwd
 * reflection into the workspace store is centralised here through three reconcile paths:
 *
 * 1. **push**: every `onChanged(info)` with a populated `cwd` is forwarded to
 *    `updatePaneCwdByPtyId`. This is the steady-state path during normal use.
 * 2. **pull A (workspace-side first)**: a `useWorkspaceStore` subscription watches each pane's
 *    `ptyId` transition from `null` to a value and replays the current paneInfo snapshot. This
 *    rescues the case where the first `onChanged` arrives before `setPanePtyId` has resolved.
 * 3. **pull B (paneInfo-side late)**: once `loadPaneInfo()` resolves, every PTY currently visible
 *    on the workspace store is replayed against the freshly populated snapshot. This rescues the
 *    case where `setPanePtyId` settled before `loadPaneInfo()` returned — `list()` does not emit
 *    `onChanged`, so without this second sweep the workspace cwd would never see the snapshot.
 *
 * `updatePaneCwdByPtyId` and the workspace store both early-return when the cwd is unchanged, so
 * overlapping pushes and pulls never bump `workspace.updatedAt` twice for the same value.
 */
export function usePaneInfoBridge(): void {
  const didLoadRef = useRef(false);

  useEffect(() => {
    // Replays the paneInfo snapshot into workspace cwd for the given PTY ids. All three reconcile
    // paths funnel through this helper so behaviour stays identical regardless of which path won.
    const syncWorkspaceCwdsFromPaneInfoSnapshot = (ptyIds: Iterable<string>): void => {
      const infos = usePaneInfoStore.getState().infosByPtyId;
      const workspaceApi = useWorkspaceStore.getState();
      for (const ptyId of ptyIds) {
        const cwd = infos[ptyId]?.cwd;
        if (cwd) {
          workspaceApi.updatePaneCwdByPtyId(ptyId, cwd);
        }
      }
    };

    const unsubscribeChanged = window.api.paneInfo.onChanged((info) => {
      usePaneInfoStore.getState().setInfo(info);
      if (info.cwd) {
        useWorkspaceStore.getState().updatePaneCwdByPtyId(info.ptyId, info.cwd);
      }
    });

    // Pull path A: trigger once per PTY id when the workspace first observes a non-null ptyId.
    // The set is local to this effect because `usePaneInfoBridge` is mounted once near the React
    // root; if it ever unmounts the next mount needs to reseed.
    const seenPtyIds = new Set<string>();
    const unsubscribeWorkspace = useWorkspaceStore.subscribe((state) => {
      const newlySeen: string[] = [];
      for (const workspace of state.workspaces) {
        for (const pane of workspace.panes) {
          if (!pane.ptyId || seenPtyIds.has(pane.ptyId)) {
            continue;
          }
          seenPtyIds.add(pane.ptyId);
          newlySeen.push(pane.ptyId);
        }
      }
      if (newlySeen.length > 0) {
        syncWorkspaceCwdsFromPaneInfoSnapshot(newlySeen);
      }
    });

    if (!didLoadRef.current) {
      didLoadRef.current = true;
      void usePaneInfoStore
        .getState()
        .loadPaneInfo()
        .then(() => {
          // Pull path B: by the time `loadPaneInfo()` resolves, pull path A may have already
          // recorded ptyIds in `seenPtyIds` with no snapshot to reflect. Replay every currently
          // visible ptyId here — `applyCwdUpdate` early-returns when the cwd is unchanged.
          const allPtyIds: string[] = [];
          for (const workspace of useWorkspaceStore.getState().workspaces) {
            for (const pane of workspace.panes) {
              if (pane.ptyId) {
                allPtyIds.push(pane.ptyId);
              }
            }
          }
          if (allPtyIds.length > 0) {
            syncWorkspaceCwdsFromPaneInfoSnapshot(allPtyIds);
          }
        });
    }

    return (): void => {
      unsubscribeChanged();
      unsubscribeWorkspace();
    };
  }, []);
}
