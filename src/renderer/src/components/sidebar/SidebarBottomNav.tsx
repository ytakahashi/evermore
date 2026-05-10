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
  const activeView = useUiStore((state) => state.activeView);
  const setSidebarView = useUiStore((state) => state.setSidebarView);
  // The Workspaces / Connections tabs are "active" only when the workspace pane is showing — when
  // SettingsView is open we render them as inactive so the user can see at a glance that clicking
  // either will return them to the workspace context.
  const isActive = sidebarView === view && activeView === 'workspace';

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
 * Bottom-navigation strip wired to {@link useUiStore} for switching the sidebar between Workspaces
 * and Connections, and for toggling the SettingsView (Mac standard: clicking the gear opens
 * settings, clicking it again is a no-op so it does not behave differently from Cmd+,).
 */
export function SidebarBottomNav(): React.JSX.Element {
  const activeView = useUiStore((state) => state.activeView);
  const openSettings = useUiStore((state) => state.openSettings);
  const isSettingsActive = activeView === 'settings';

  return (
    <nav className="flex items-center justify-around border-t border-border bg-panel p-1">
      <SidebarViewButton label="Workspaces" view="workspaces">
        <Folders size={18} />
      </SidebarViewButton>
      <SidebarViewButton label="Connections" view="connections">
        <Zap size={18} />
      </SidebarViewButton>
      <button
        aria-current={isSettingsActive ? 'page' : undefined}
        aria-label="Settings"
        className={getButtonClassName(isSettingsActive)}
        onClick={() => {
          openSettings();
        }}
        type="button"
      >
        <Settings size={18} />
      </button>
    </nav>
  );
}
