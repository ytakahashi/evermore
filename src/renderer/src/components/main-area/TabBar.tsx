import { selectActiveTab, useWorkspaceStore } from '../../stores/workspaceStore';

export function TabBar(): React.JSX.Element {
  const activeTab = useWorkspaceStore(selectActiveTab);

  return (
    <div className="flex h-9 items-center border-b border-border bg-panel px-2">
      <div className="flex h-full min-w-32 items-center border-r border-border bg-terminal px-3 text-xs">
        <span className="truncate">{activeTab?.title ?? 'zsh'}</span>
      </div>
    </div>
  );
}
