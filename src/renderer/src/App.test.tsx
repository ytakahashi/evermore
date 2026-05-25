import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Workspace } from '../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import { usePaneInfoStore } from './stores/paneInfoStore';
import { useSettingsStore } from './stores/settingsStore';
import { useTunnelsStore } from './stores/tunnelsStore';
import { useUiStore } from './stores/uiStore';

vi.mock('./components/terminal/TerminalView', () => ({
  TerminalView: () => <div>Terminal View</div>,
}));

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'tab-1',
      name: 'zsh',
      layout: {
        type: 'leaf',
        paneId: 'pane-1',
      },
      activePaneId: 'pane-1',
    },
  ],
  panes: [
    {
      id: 'pane-1',
      cwd: '/Users/tester',
    },
  ],
  activeTabId: 'tab-1',
  createdAt: 1,
  updatedAt: 1,
};

describe('App', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        pty: {},
        paneInfo: {
          list: vi.fn(() => Promise.resolve([])),
          notifyCommand: vi.fn(() => Promise.resolve()),
          onChanged: vi.fn(() => vi.fn()),
        },
        workspace: {
          list: vi.fn(() => Promise.resolve({ workspaces: [workspace], activeWorkspaceId: null })),
          get: vi.fn(() => Promise.resolve(workspace)),
          create: vi.fn(() => Promise.resolve(workspace)),
          update: vi.fn(() => Promise.resolve()),
          delete: vi.fn(() => Promise.resolve()),
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
        },
        ssh: {},
        tunnel: {
          list: vi.fn(() => Promise.resolve([])),
          start: vi.fn(() => Promise.resolve()),
          stop: vi.fn(() => Promise.resolve()),
          logs: vi.fn(() => Promise.resolve([])),
          onStatusChanged: vi.fn(() => vi.fn()),
          onLog: vi.fn(() => vi.fn()),
        },
        settings: {
          get: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          update: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          reset: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          reload: vi.fn(() => Promise.resolve(structuredClone(DEFAULT_APP_SETTINGS))),
          openFile: vi.fn(() => Promise.resolve()),
          getFilePath: vi.fn(() => Promise.resolve('/tmp/evermore/settings.json')),
        },
        window: {
          isFullScreen: vi.fn(() => Promise.resolve(false)),
          onFullScreenChanged: vi.fn(() => vi.fn()),
        },
        shortcuts: {
          onInvoke: vi.fn(() => vi.fn()),
        },
      } as unknown as Window['api'],
    });
  });

  afterEach(() => {
    useTunnelsStore.setState({ tunnels: [], isLoading: false, error: null });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useUiStore.setState({ activeView: 'workspace' });
    Reflect.deleteProperty(window, 'api');
  });

  it('renders the application shell', async () => {
    // Given: the app can render without requiring a real terminal process.

    // When: the root app component is mounted.
    render(<App />);

    // Then: the primary scaffold regions are visible.
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    await waitFor(() => {
      // TopBar shows the active workspace name once workspaces are loaded.
      expect(screen.getAllByText('Default')).not.toHaveLength(0);
    });
    await waitFor(() => expect(screen.getByText('Terminal View')).toBeInTheDocument());
  });

  it('renders named sidebar navigation buttons', () => {
    // Given: the sidebar bottom navigation uses icon-only controls.

    // When: the root app component is mounted.
    render(<App />);

    // Then: each icon-only control exposes an accessible name.
    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
