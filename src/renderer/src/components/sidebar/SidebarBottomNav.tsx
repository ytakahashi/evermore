import { Folders, Settings, Zap } from 'lucide-react';
import { useUiStore, type SidebarView } from '../../stores/uiStore';

function getButtonClassName(isActive: boolean): string {
  return isActive
    ? 'rounded bg-raised p-1.5 text-brand'
    : 'rounded p-1.5 text-muted hover:bg-raised hover:text-foreground';
}

interface SidebarViewButtonProps {
  label: string;
  view: SidebarView;
  children: React.ReactNode;
}

function SidebarViewButton({ label, view, children }: SidebarViewButtonProps): React.JSX.Element {
  const sidebarView = useUiStore((state) => state.sidebarView);
  const setSidebarView = useUiStore((state) => state.setSidebarView);
  const isActive = sidebarView === view;

  return (
    <button
      aria-current={isActive ? 'page' : undefined}
      aria-label={label}
      className={getButtonClassName(isActive)}
      type="button"
      onClick={() => {
        setSidebarView(view);
      }}
    >
      {children}
    </button>
  );
}

/**
 * Bottom-navigation strip wired to {@link useUiStore} for switching the sidebar
 * between Workspaces and Connections. Settings is intentionally disabled until
 * when we implement it in a future phase.
 */
export function SidebarBottomNav(): React.JSX.Element {
  return (
    <nav className="flex items-center justify-around border-t border-border bg-panel p-1">
      <SidebarViewButton label="Workspaces" view="workspaces">
        <Folders size={18} />
      </SidebarViewButton>
      <SidebarViewButton label="Connections" view="connections">
        <Zap size={18} />
      </SidebarViewButton>
      <button
        aria-label="Settings"
        className="rounded p-1.5 text-muted opacity-40"
        disabled
        title="Settings coming in a future update"
        type="button"
      >
        <Settings size={18} />
      </button>
    </nav>
  );
}
