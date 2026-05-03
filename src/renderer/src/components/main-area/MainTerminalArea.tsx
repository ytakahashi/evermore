import { useEffect } from 'react';
import { selectActivePane, useWorkspaceStore } from '../../stores/workspaceStore';
import { TabBar } from './TabBar';
import { TerminalView } from '../terminal/TerminalView';

export function MainTerminalArea(): React.JSX.Element {
  const activePane = useWorkspaceStore(selectActivePane);
  const error = useWorkspaceStore((state) => state.error);
  const isLoading = useWorkspaceStore((state) => state.isLoading);
  const loadWorkspaces = useWorkspaceStore((state) => state.loadWorkspaces);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  let content: React.JSX.Element;
  if (isLoading && !activePane) {
    content = <div className="p-4 text-sm text-muted">Loading workspace...</div>;
  } else if (error && !activePane) {
    content = <div className="p-4 text-sm text-danger">Failed to load workspace: {error}</div>;
  } else if (activePane) {
    content = <TerminalView key={activePane.id} cwd={activePane.cwd} />;
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
