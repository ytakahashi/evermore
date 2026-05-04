import { Folder, ChevronRight, Hash } from 'lucide-react';
import { selectActiveTab, useWorkspaceStore } from '../../stores/workspaceStore';

export function WorkspacesView(): React.JSX.Element {
  const activeTab = useWorkspaceStore(selectActiveTab);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
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
            <button
              key={workspace.id}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                isActive ? 'bg-raised text-foreground' : 'text-muted hover:bg-raised/50'
              }`}
              type="button"
              onClick={() => {
                setActiveWorkspace(workspace.id);
              }}
            >
              <ChevronRight
                size={14}
                className={isActive ? 'rotate-90 text-subtle' : 'text-subtle'}
              />
              <Folder size={14} className={isActive ? 'text-brand' : 'text-subtle'} />
              <span className="truncate">{workspace.name}</span>
            </button>
          );
        })}
        {activeTab ? (
          <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted">
            <div className="w-3.5" />
            <Hash size={14} className="text-subtle" />
            <span className="truncate">{activeTab.title}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
