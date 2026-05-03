import { Plus, X } from 'lucide-react';
import { selectActiveWorkspace, useWorkspaceStore } from '../../stores/workspaceStore';

export function TabBar(): React.JSX.Element {
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const tabs = activeWorkspace?.tabs ?? [];
  const activeTabId = activeWorkspace?.activeTabId ?? null;
  const canCloseTabs = tabs.length > 1;

  return (
    <div className="flex h-9 items-center overflow-hidden border-b border-border bg-panel px-2">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <div
              key={tab.id}
              className={`flex h-full min-w-36 max-w-52 items-center border-r border-border text-xs ${
                isActive ? 'bg-terminal text-foreground' : 'bg-panel text-muted hover:bg-raised/50'
              }`}
            >
              <button
                aria-current={isActive ? 'page' : undefined}
                className="h-full min-w-0 flex-1 px-3 text-left"
                type="button"
                onClick={() => {
                  selectTab(tab.id);
                }}
              >
                <span className="block truncate">{tab.title}</span>
              </button>
              <button
                aria-label={`Close ${tab.title}`}
                className="mr-1 flex size-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-subtle"
                disabled={!canCloseTabs}
                title={canCloseTabs ? `Close ${tab.title}` : 'At least one tab is required'}
                type="button"
                onClick={() => {
                  closeTab(tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        aria-label="New tab"
        className="ml-2 flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        disabled={!activeWorkspace}
        title="New tab"
        type="button"
        onClick={addTab}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
