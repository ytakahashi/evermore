import { SidebarBottomNav } from '../sidebar/SidebarBottomNav';
import { ConnectionsView } from '../sidebar/ConnectionsView';
import { WorkspacesView } from '../sidebar/WorkspacesView';
import { useUiStore } from '../../stores/uiStore';

export function Sidebar(): React.JSX.Element {
  const sidebarView = useUiStore((state) => state.sidebarView);

  return (
    <aside className="flex w-60 flex-col border-r border-border bg-panel">
      <div className="flex-1 overflow-y-auto p-2">
        {sidebarView === 'workspaces' ? <WorkspacesView /> : <ConnectionsView />}
      </div>
      <SidebarBottomNav />
    </aside>
  );
}
