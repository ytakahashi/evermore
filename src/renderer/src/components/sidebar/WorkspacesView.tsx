import { Folder, ChevronRight, Hash } from 'lucide-react';

export function WorkspacesView(): React.JSX.Element {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
        Workspaces
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-sm text-foreground">
          <ChevronRight size={14} className="rotate-90 text-subtle" />
          <Folder size={14} className="text-brand" />
          <span>evermore</span>
        </div>
        <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted hover:bg-raised/50">
          <div className="w-3.5" />
          <Hash size={14} className="text-subtle" />
          <span>web</span>
        </div>
      </div>
    </div>
  );
}
