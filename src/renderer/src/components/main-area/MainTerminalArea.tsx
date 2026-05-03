import { useEffect } from 'react';
import {
  findFirstPaneId,
  selectActiveWorkspace,
  useWorkspaceStore,
} from '../../stores/workspaceStore';
import { TabBar } from './TabBar';
import { TerminalView } from '../terminal/TerminalView';

export function MainTerminalArea(): React.JSX.Element {
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const error = useWorkspaceStore((state) => state.error);
  const isLoading = useWorkspaceStore((state) => state.isLoading);
  const loadWorkspaces = useWorkspaceStore((state) => state.loadWorkspaces);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  let content: React.JSX.Element;
  if (isLoading && !activeWorkspace) {
    content = <div className="p-4 text-sm text-muted">Loading workspace...</div>;
  } else if (error && !activeWorkspace) {
    content = <div className="p-4 text-sm text-danger">Failed to load workspace: {error}</div>;
  } else if (activeWorkspace) {
    content = (
      <div className="relative h-full min-h-0 w-full">
        {activeWorkspace.tabs.map((tab) => {
          const paneId = tab.activePaneId ?? findFirstPaneId(tab.layout);
          const pane = activeWorkspace.panes.find((currentPane) => currentPane.id === paneId);
          const isActive = tab.id === activeWorkspace.activeTabId;

          if (!pane) {
            return null;
          }

          return (
            <div
              key={tab.id}
              aria-hidden={!isActive}
              className={`absolute inset-0 min-h-0 w-full ${
                isActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
              }`}
            >
              <TerminalView key={pane.id} cwd={pane.cwd} />
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
