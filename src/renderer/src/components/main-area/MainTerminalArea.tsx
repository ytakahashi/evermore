import { useEffect, useMemo, useRef } from 'react';
import { flattenLayout } from '../../../../shared/pane-layout';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneCell } from './PaneCell';
import { PaneSplitters } from './PaneSplitters';
import { TabBar } from './TabBar';

interface ActiveSelection {
  paneId: string | null;
  tabId: string | null;
  workspaceId: string | null;
}

export function MainTerminalArea(): React.JSX.Element {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const error = useWorkspaceStore((state) => state.error);
  const isLoading = useWorkspaceStore((state) => state.isLoading);
  const loadWorkspaces = useWorkspaceStore((state) => state.loadWorkspaces);
  const clearFullscreen = useUiStore((state) => state.clearFullscreen);
  const fullscreenPaneId = useUiStore((state) => state.fullscreenPaneId);
  const tabBarOpen = useUiStore((state) => state.tabBarOpen);
  const previousActiveSelectionRef = useRef<ActiveSelection | null>(null);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeTab =
    activeWorkspace?.tabs.find((tab) => tab.id === activeWorkspace.activeTabId) ?? null;
  const activeTabId = activeTab?.id ?? null;
  const activePaneId = activeTab?.activePaneId ?? null;
  const activePaneIds = useMemo(
    () => (activeTab ? flattenLayout(activeTab.layout).panes.map((pane) => pane.paneId) : []),
    [activeTab],
  );
  const activeFullscreenPaneId =
    fullscreenPaneId && activePaneIds.includes(fullscreenPaneId) ? fullscreenPaneId : null;
  const isFullscreenLayout = activeFullscreenPaneId !== null;
  const renderedPanes = useMemo(
    () =>
      workspaces.flatMap((workspace) => {
        const isActiveWorkspace = workspace.id === activeWorkspaceId;

        return workspace.tabs.flatMap((tab) => {
          const isActiveTab = isActiveWorkspace && tab.id === workspace.activeTabId;

          return flattenLayout(tab.layout).panes.flatMap((rect) => {
            const pane = workspace.panes.find((currentPane) => currentPane.id === rect.paneId);
            if (!pane) {
              console.warn(`Pane with id ${rect.paneId} not found for leaf layout`);
              return [];
            }

            return [{ isActiveWorkspace, isActiveTab, pane, rect, tab }];
          });
        });
      }),
    [activeWorkspaceId, workspaces],
  );
  const activeSplitRects = useMemo(
    () => (activeTab && !isFullscreenLayout ? flattenLayout(activeTab.layout).splits : []),
    [activeTab, isFullscreenLayout],
  );

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    const previousActiveSelection = previousActiveSelectionRef.current;
    const activeSelection = {
      paneId: activePaneId,
      tabId: activeTabId,
      workspaceId: activeWorkspaceId,
    };
    previousActiveSelectionRef.current = activeSelection;

    if (!fullscreenPaneId || !previousActiveSelection) {
      return;
    }

    if (
      previousActiveSelection.workspaceId !== activeSelection.workspaceId ||
      previousActiveSelection.tabId !== activeSelection.tabId
    ) {
      clearFullscreen();
      return;
    }

    if (
      previousActiveSelection.paneId !== activeSelection.paneId &&
      fullscreenPaneId !== activeSelection.paneId
    ) {
      clearFullscreen();
    }
  }, [activePaneId, activeTabId, activeWorkspaceId, clearFullscreen, fullscreenPaneId]);

  useEffect(() => {
    if (!fullscreenPaneId) {
      return;
    }

    if (!activePaneIds.includes(fullscreenPaneId)) {
      clearFullscreen();
    }
  }, [activePaneIds, clearFullscreen, fullscreenPaneId]);

  let content: React.JSX.Element;
  if (isLoading && workspaces.length === 0) {
    content = <div className="p-4 text-sm text-muted">Loading workspace...</div>;
  } else if (error && workspaces.length === 0) {
    content = <div className="p-4 text-sm text-danger">Failed to load workspace: {error}</div>;
  } else if (workspaces.length > 0) {
    content = (
      <div className="relative h-full min-h-0 w-full">
        {/* Every pane of every workspace is mounted in one flat list keyed by `pane.id`. Keeping a
            pane at a stable position in the React tree (independent of which tab or workspace owns
            it) means React preserves the live PTY/xterm when its layout ownership changes.
            `pane.id` is guaranteed globally unique by the main-process `WorkspaceStore`.

            Non-active workspaces are hidden with `display: none` so their terminals are not painted
            while their PTYs stay alive; the active workspace's inactive tabs use `opacity-0` so a
            tab switch reveals an already-sized terminal. `display: none` can let a hidden xterm
            report zero size and drift to the fallback PTY size — accepted, as before, because
            keeping PTYs alive is the higher priority. */}
        {renderedPanes.map((descriptor) => {
          const isFullscreen = activeFullscreenPaneId === descriptor.pane.id;
          return (
            <PaneCell
              key={descriptor.pane.id}
              {...descriptor}
              isFullscreen={isFullscreen}
              isFullscreenLayout={descriptor.isActiveTab && isFullscreenLayout}
              rect={
                isFullscreen
                  ? {
                      paneId: descriptor.pane.id,
                      leftPct: 0,
                      topPct: 0,
                      widthPct: 100,
                      heightPct: 100,
                    }
                  : descriptor.rect
              }
            />
          );
        })}
        {activeSplitRects.length > 0 && <PaneSplitters splits={activeSplitRects} />}
      </div>
    );
  } else {
    content = <div className="p-4 text-sm text-muted">No workspace is available.</div>;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-terminal">
      {tabBarOpen && <TabBar />}
      <div className="min-h-0 flex-1">{content}</div>
    </main>
  );
}
