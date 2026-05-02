import { SidebarBottomNav } from '../sidebar/SidebarBottomNav';
import { WorkspacesView } from '../sidebar/WorkspacesView';

export function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex w-60 flex-col border-r border-border bg-panel">
      <div className="flex-1 overflow-y-auto p-2">
        <WorkspacesView />
      </div>
      <SidebarBottomNav />
    </aside>
  );
}
