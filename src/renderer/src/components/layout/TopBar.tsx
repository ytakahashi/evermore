import { Folder, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  selectErrorTunnelCount,
  selectRunningTunnelCount,
  useTunnelsStore,
} from '../../stores/tunnelsStore';
import { useUiStore } from '../../stores/uiStore';
import { selectActiveWorkspace, useWorkspaceStore } from '../../stores/workspaceStore';

interface TunnelBadgeProps {
  errorCount: number;
  runningCount: number;
}

function TunnelBadge({ errorCount, runningCount }: TunnelBadgeProps): React.JSX.Element | null {
  const setSidebarView = useUiStore((state) => state.setSidebarView);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);

  if (errorCount === 0 && runningCount === 0) {
    return null;
  }

  const hasErrors = errorCount > 0;
  const segments: string[] = [];
  if (hasErrors) {
    segments.push(`${errorCount} error`);
  }
  if (runningCount > 0) {
    segments.push(`${runningCount} running`);
  }

  return (
    <button
      className={`flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-[11px] font-medium hover:bg-raised hover:text-foreground ${
        hasErrors ? 'text-danger' : 'text-muted'
      }`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      title="View tunnels in sidebar"
      type="button"
      onClick={() => {
        setSidebarView('connections');
        setSidebarOpen(true);
      }}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${hasErrors ? 'bg-status-error' : 'bg-status-running'}`}
      />
      <span>Tunnels: {segments.join(', ')}</span>
    </button>
  );
}

export function TopBar(): React.JSX.Element {
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const runningTunnelCount = useTunnelsStore(selectRunningTunnelCount);
  const errorTunnelCount = useTunnelsStore(selectErrorTunnelCount);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <header
      className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-panel pl-20 pr-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted">
        <button
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          type="button"
          onClick={toggleSidebar}
        >
          {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <Folder size={12} />
        <span className="truncate">{activeWorkspace?.name ?? ''}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TunnelBadge errorCount={errorTunnelCount} runningCount={runningTunnelCount} />
      </div>
    </header>
  );
}
