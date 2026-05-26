import { useEffect } from 'react';
import { MainTerminalArea } from '../main-area/MainTerminalArea';
import { SettingsView } from '../settings/SettingsView';
import { useUiStore } from '../../stores/uiStore';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Renders the workspace pane and the settings pane as siblings, toggling visibility via
 * `display:none` instead of unmounting either tree.
 *
 * Why mount both: the settings entry point must preserve any running PTY processes when the user
 * opens / closes the settings view, mirroring how `MainTerminalArea` already keeps non-active
 * workspaces mounted while hidden. Unmounting the workspace tree on settings-open would tear down
 * every xterm container and force a full re-init when returning. The price is one extra subtree in
 * the React commit; both subtrees still own their own state, and only the visible one paints.
 */
export function AppShell(): React.JSX.Element {
  const activeView = useUiStore((state) => state.activeView);
  const closeSettings = useUiStore((state) => state.closeSettings);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Esc closes the settings view. The application menu owns `Cmd+,` (Preferences…) via the
      // shortcut dispatcher, so opening settings is not handled here. Outside the settings view
      // Esc must reach the terminal (vim, less, etc.), so we only swallow it while settings is
      // the active view.
      if (event.key === 'Escape') {
        const currentActiveView = useUiStore.getState().activeView;
        if (currentActiveView === 'settings') {
          event.preventDefault();
          closeSettings();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeSettings]);

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
        </div>
      </div>
    </div>
  );
}
