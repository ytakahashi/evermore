import { useEffect, useMemo, useRef } from 'react';
import { flattenLayout } from '../../../../shared/pane-layout';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneLayout } from './PaneLayout';
import { TabBar } from './TabBar';

interface ActiveSelection {
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
  const previousActiveSelectionRef = useRef<ActiveSelection | null>(null);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeTab =
    activeWorkspace?.tabs.find((tab) => tab.id === activeWorkspace.activeTabId) ?? null;
  const activeTabId = activeTab?.id ?? null;
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
    }
  }, [activeTabId, activeWorkspaceId, clearFullscreen, fullscreenPaneId]);

  useEffect(() => {
    if (!fullscreenPaneId) {
      return;
    }

    if (!activePaneIds.includes(fullscreenPaneId)) {
      clearFullscreen();
    }
  }, [activePaneIds, clearFullscreen, fullscreenPaneId]);

  useEffect(() => {
    if (!fullscreenPaneId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !event.metaKey) {
        return;
      }

      // `useTerminal` swallows this same chord inside xterm so fullscreen can close without also
      // sending ESC to the PTY, which would affect terminal apps such as vim.
      event.preventDefault();
      clearFullscreen();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clearFullscreen, fullscreenPaneId]);

  let content: React.JSX.Element;
  if (isLoading && workspaces.length === 0) {
    content = <div className="p-4 text-sm text-muted">Loading workspace...</div>;
  } else if (error && workspaces.length === 0) {
    content = <div className="p-4 text-sm text-danger">Failed to load workspace: {error}</div>;
  } else if (workspaces.length > 0) {
    content = (
      <div className="relative h-full min-h-0 w-full">
        {workspaces.map((workspace) => {
          const isActiveWorkspace = workspace.id === activeWorkspaceId;

          return (
            // Current implementation keeps non-active workspaces mounted so their PTY processes survive workspace
            // switches. This eagerly creates PTYs for every loaded workspace; a later pane-runtime
            // layer should lazy-mount only visited workspaces and then keep those mounted.
            //
            // `display: none` can make hidden xterm containers report zero dimensions and trigger a
            // resize to the fallback PTY size. That wrapping drift is accepted for now because
            // preserving running PTYs is the higher-priority workspace behavior.
            <div
              key={workspace.id}
              aria-hidden={!isActiveWorkspace}
              className="absolute inset-0 min-h-0 w-full"
              style={{ display: isActiveWorkspace ? undefined : 'none' }}
            >
              {workspace.tabs.map((tab) => {
                const isActive = tab.id === workspace.activeTabId;

                return (
                  <div
                    key={tab.id}
                    aria-hidden={!isActive}
                    className={`absolute inset-0 min-h-0 w-full ${
                      isActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
                    }`}
                  >
                    <PaneLayout
                      isActiveTab={isActiveWorkspace && isActive}
                      layout={tab.layout}
                      panes={workspace.panes}
                      tab={tab}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  } else {
    content = <div className="p-4 text-sm text-muted">No workspace is available.</div>;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-terminal">
      <TabBar />
      <div className="min-h-0 flex-1">{content}</div>
    </main>
  );
}
