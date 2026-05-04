import { useEffect } from 'react';
import { selectActiveWorkspace, useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneLayout } from './PaneLayout';
import { TabBar } from './TabBar';

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
          const isActive = tab.id === activeWorkspace.activeTabId;

          return (
            <div
              key={tab.id}
              aria-hidden={!isActive}
              className={`absolute inset-0 min-h-0 w-full ${
                isActive ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'
              }`}
            >
              <PaneLayout
                isActiveTab={isActive}
                layout={tab.layout}
                panes={activeWorkspace.panes}
                tab={tab}
              />
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
