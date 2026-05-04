import { Folder } from 'lucide-react';
import { selectActiveWorkspace, useWorkspaceStore } from '../../stores/workspaceStore';

export function TopBar(): React.JSX.Element {
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);

  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-panel pl-20 pr-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        <Folder size={12} />
        <span>{activeWorkspace?.name ?? ''}</span>
      </div>
      <div />
    </header>
  );
}
