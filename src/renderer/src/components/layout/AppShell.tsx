import { useEffect } from 'react';
import { AgentsView } from '../agents/AgentsView';
import { MainTerminalArea } from '../main-area/MainTerminalArea';
import { TabSearchPalette } from '../main-area/TabSearchPalette';
import { SettingsView } from '../settings/SettingsView';
import { useUiStore } from '../../stores/uiStore';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Renders the workspace pane and each alternative main-area view as siblings, toggling visibility
 * via `display:none` instead of unmounting any of them.
 *
 * Why mount all of them: switching the main area must preserve any running PTY processes, mirroring
 * how `MainTerminalArea` already keeps non-active workspaces mounted while hidden. Unmounting the
 * workspace tree when another view opens would tear down every xterm container and force a full
 * re-init on return. The price is a few extra subtrees in the React commit; each still owns its own
 * state, and only the visible one paints.
 */
export function AppShell(): React.JSX.Element {
  const activeView = useUiStore((state) => state.activeView);
  const showWorkspaceView = useUiStore((state) => state.showWorkspaceView);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Esc dismisses whichever view has taken over the main area. Opening those views is not
      // handled here — the application menu owns their accelerators via the shortcut dispatcher.
      // In the workspace view Esc must reach the terminal (vim, less, etc.), which is exactly what
      // this condition excludes.
      if (event.key === 'Escape') {
        const currentActiveView = useUiStore.getState().activeView;
        if (currentActiveView !== 'workspace') {
          event.preventDefault();
          showWorkspaceView();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showWorkspaceView]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <div className="relative flex flex-1 min-w-0">
          <div
            aria-hidden={activeView !== 'workspace'}
            className="absolute inset-0 flex min-w-0"
            style={{ display: activeView === 'workspace' ? undefined : 'none' }}
          >
            <MainTerminalArea />
          </div>
          <div
            aria-hidden={activeView !== 'settings'}
            className="absolute inset-0 flex min-w-0"
            style={{ display: activeView === 'settings' ? undefined : 'none' }}
          >
            <SettingsView />
          </div>
          <div
            aria-hidden={activeView !== 'agents'}
            className="absolute inset-0 flex min-w-0"
            style={{ display: activeView === 'agents' ? undefined : 'none' }}
          >
            <AgentsView />
          </div>
          <TabSearchPalette />
        </div>
      </div>
    </div>
  );
}
