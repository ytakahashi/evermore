import { Folder, ChevronRight, Hash } from 'lucide-react';
import { countPaneLeaves } from '../../../../shared/pane-layout';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function formatPaneCount(count: number): string {
  return `${count} ${count === 1 ? 'pane' : 'panes'}`;
}

export function WorkspacesView(): React.JSX.Element {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const selectWorkspaceTab = useWorkspaceStore((state) => state.selectWorkspaceTab);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const workspaces = useWorkspaceStore((state) => state.workspaces);

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
        Workspaces
      </div>
      <div className="space-y-0.5">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;

          return (
            <div key={workspace.id} className="space-y-0.5">
              <button
                aria-current={isActive ? 'page' : undefined}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                  isActive ? 'bg-raised text-foreground' : 'text-muted hover:bg-raised/50'
                }`}
                type="button"
                onClick={() => {
                  setActiveWorkspace(workspace.id);
                }}
              >
                <ChevronRight size={14} className="rotate-90 text-subtle" />
                <Folder size={14} className={isActive ? 'text-brand' : 'text-subtle'} />
                <span className="truncate">{workspace.name}</span>
              </button>
              <div className="space-y-0.5">
                {workspace.tabs.map((tab) => {
                  const paneCount = countPaneLeaves(tab.layout);
                  const isActiveTab = isActive && tab.id === workspace.activeTabId;
                  const label = `${tab.title} (${formatPaneCount(paneCount)})`;

                  return (
                    <button
                      key={tab.id}
                      aria-current={isActiveTab ? 'page' : undefined}
                      className={`flex w-full items-center gap-2 rounded-md py-1 pl-8 pr-2 text-left text-sm ${
                        isActiveTab
                          ? 'bg-terminal text-foreground'
                          : 'text-muted hover:bg-raised/50'
                      }`}
                      type="button"
                      onClick={() => {
                        selectWorkspaceTab(workspace.id, tab.id);
                      }}
                    >
                      <Hash size={14} className={isActiveTab ? 'text-brand' : 'text-subtle'} />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
