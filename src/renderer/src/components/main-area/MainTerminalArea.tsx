import { useEffect, useMemo, useRef } from 'react';
import { flattenLayout } from '../../../../shared/pane-layout';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneLayout } from './PaneLayout';
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
        {/* Every tab of every workspace is mounted in one flat list keyed by `tab.id`. Keeping a tab
            at a stable position in the React tree (independent of which workspace owns it) means
            React preserves its subtree — and therefore its live PTYs/terminals — when the tab is
            reordered or moved to another workspace. `tab.id` is guaranteed globally unique by the
            main-process `WorkspaceStore`, so these sibling keys never collide.

            Non-active workspaces are hidden with `display: none` so their terminals are not painted
            while their PTYs stay alive; the active workspace's inactive tabs use `opacity-0` so a
            tab switch reveals an already-sized terminal. `display: none` can let a hidden xterm
            report zero size and drift to the fallback PTY size — accepted, as before, because
            keeping PTYs alive is the higher priority. */}
        {workspaces.flatMap((workspace) => {
          const isActiveWorkspace = workspace.id === activeWorkspaceId;

          return workspace.tabs.map((tab) => {
            const isActive = isActiveWorkspace && tab.id === workspace.activeTabId;

            return (
              <div
                key={tab.id}
                aria-hidden={!isActive}
                className={`absolute inset-0 min-h-0 w-full ${
                  isActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
                }`}
                style={{ display: isActiveWorkspace ? undefined : 'none' }}
              >
                <PaneLayout
                  isActiveTab={isActive}
                  layout={tab.layout}
                  panes={workspace.panes}
                  tab={tab}
                />
              </div>
            );
          });
        })}
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
