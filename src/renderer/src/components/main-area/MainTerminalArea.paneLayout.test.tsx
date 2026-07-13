import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings-defaults';
import type { Workspace } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../../stores/workspaceStore';
import { MainTerminalArea } from './MainTerminalArea';
import type { PtyIdChangeReason } from '../terminal/useTerminal';

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

// Mock the terminal so pane split/close/resize/fullscreen/PTY-lifecycle behavior can be driven and
// asserted without spinning up xterm or a PTY. Rendering the real `PaneCell`/`PaneSplitters` (via
// the real `MainTerminalArea`) rather than mocking them is what makes these tests exercise the
// same tree the app actually mounts.
vi.mock('../terminal/TerminalView', () => ({
  TerminalView: ({
    cwd,
    isActive,
    onPtyIdChange,
  }: {
    cwd?: string;
    isActive?: boolean;
    onPtyIdChange?: (ptyId: string | null, reason: PtyIdChangeReason) => void;
  }) => (
    <div data-active={isActive ? 'true' : 'false'} data-testid="terminal-view">
      {cwd}
      {/* Test-only hook to simulate the PTY id lifecycle without spinning up a real terminal. */}
      <button
        data-testid="terminal-exit-pty"
        type="button"
        onClick={() => onPtyIdChange?.(null, 'exit')}
      >
        exit pty
      </button>
      <button
        data-testid="terminal-unmount-pty"
        type="button"
        onClick={() => onPtyIdChange?.(null, 'unmount')}
      >
        clear pty
      </button>
    </div>
  ),
}));

const initialWorkspaceStoreState = useWorkspaceStore.getState();
const initialUiStoreState = useUiStore.getState();

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'tab-1',
      name: 'zsh',
      isCustomName: false,
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

function setWorkspaces(workspaces: Workspace[], activeWorkspaceId: string): void {
  useWorkspaceStore.setState({
    workspaces,
    activeWorkspaceId,
    isLoading: false,
    error: null,
    // Prevent the mount effect from calling the (unmocked) list IPC and clobbering this state.
    loadWorkspaces: vi.fn<WorkspaceStoreState['loadWorkspaces']>(() => Promise.resolve()),
  });
}

describe('MainTerminalArea pane layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          update: vi.fn(() => Promise.resolve()),
        },
      } as unknown as Window['api'],
    });
    setWorkspaces([workspace], workspace.id);
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({ fullscreenPaneId: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState(initialWorkspaceStoreState, true);
    useUiStore.setState(initialUiStoreState, true);
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useSettingsStore.setState({ settings: null });
    Reflect.deleteProperty(window, 'api');
    vi.useRealTimers();
  });

  it('renders a leaf terminal pane', () => {
    // Given / When: the active tab has one leaf pane.
    render(<MainTerminalArea />);

    // Then: one terminal is shown with the pane cwd.
    expect(screen.getByTestId('terminal-view')).toHaveTextContent('/Users/tester');
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Maximize pane' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split pane vertically' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split pane horizontally' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close pane' })).toBeDisabled();
  });

  it('splits and closes panes through toolbar actions', () => {
    // Given: the active tab has one leaf pane.
    render(<MainTerminalArea />);

    // When: the pane is split vertically.
    fireEvent.click(screen.getByRole('button', { name: 'Split pane vertically' }));

    // Then: two terminal panes are rendered and close becomes available.
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Close pane' })[0]).not.toBeDisabled();

    // When: one pane is closed.
    const secondCloseButton = screen.getAllByRole('button', { name: 'Close pane' })[1];
    if (!secondCloseButton) {
      throw new Error('Expected second close button.');
    }
    fireEvent.click(secondCloseButton);

    // Then: the workspace layout collapses back to one pane.
    expect(useWorkspaceStore.getState().workspaces[0]?.panes).toHaveLength(1);
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs[0]?.layout).toEqual({
      type: 'leaf',
      paneId: 'pane-1',
    });
  });

  it('updates split ratio when dragging a splitter', () => {
    // Given: the active tab has a vertical split.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    render(<MainTerminalArea />);
    const separator = screen.getByRole('separator', { name: 'Resize vertical split' });
    const container = separator.parentElement;
    if (!container) {
      throw new Error('Expected split container.');
    }
    Object.defineProperty(container, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    // When: the splitter is dragged to 70% of the container width.
    fireEvent.mouseDown(separator);
    fireEvent.mouseMove(window, { clientX: 70 });
    fireEvent.mouseUp(window);

    // Then: the active tab layout stores the new ratio.
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs[0]?.layout).toEqual(
      expect.objectContaining({
        ratio: 0.7,
      }),
    );
  });

  it('removes the pane info entry when a PTY id is cleared', () => {
    // Given: a pane has an active PTY id and a paneInfo snapshot for it.
    setWorkspaces(
      [
        {
          ...workspace,
          panes: [{ ...workspace.panes[0]!, ptyId: 'pty-1' }],
        },
      ],
      workspace.id,
    );
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': {
          ptyId: 'pty-1',
          processActivity: 'running',
          foregroundCommand: 'pnpm dev',
          foregroundSession: { kind: 'other' },
          integration: {
            shell: false,
            protocols: [],
            lastSequenceAt: 0,
            stale: false,
          },
          observedAt: 1,
        },
      },
      isLoading: false,
      error: null,
    });
    render(<MainTerminalArea />);

    // When: TerminalView reports the PTY id has been cleared.
    fireEvent.click(screen.getByTestId('terminal-exit-pty'));

    // Then: the renderer-side paneInfo cache no longer holds the dead PTY entry.
    expect(usePaneInfoStore.getState().infosByPtyId).toEqual({});
    expect(useWorkspaceStore.getState().workspaces[0]?.panes[0]?.ptyId).toBeUndefined();
  });

  it('removes the pane via closePaneOnExit when its PTY exits and the setting is on', () => {
    // Given: a tab with two panes, both having live PTY ids, and the close-pane-on-exit default.
    const splitWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          isCustomName: false,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'pane-1' },
              { type: 'leaf', paneId: 'pane-2' },
            ],
          },
          activePaneId: 'pane-1',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester/one', ptyId: 'pty-1' },
        { id: 'pane-2', cwd: '/Users/tester/two', ptyId: 'pty-2' },
      ],
    };
    setWorkspaces([splitWorkspace], splitWorkspace.id);
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    render(<MainTerminalArea />);

    // When: the first pane's PTY exit is simulated by clearing its PTY id.
    const clearButtons = screen.getAllByTestId('terminal-exit-pty');
    const firstClearButton = clearButtons[0];
    if (!firstClearButton) {
      throw new Error('Expected clear button for pane-1.');
    }
    fireEvent.click(firstClearButton);

    // Then: the pane is removed from the workspace layout and panes array.
    const updatedWorkspace = useWorkspaceStore.getState().workspaces[0];
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-2']);
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual({ type: 'leaf', paneId: 'pane-2' });
  });

  it('does not close the pane when its PTY id is cleared because the terminal unmounted', () => {
    // Given: a tab with two panes and close-pane-on-exit enabled.
    const splitWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          isCustomName: false,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'pane-1' },
              { type: 'leaf', paneId: 'pane-2' },
            ],
          },
          activePaneId: 'pane-1',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester/one', ptyId: 'pty-1' },
        { id: 'pane-2', cwd: '/Users/tester/two', ptyId: 'pty-2' },
      ],
    };
    setWorkspaces([splitWorkspace], splitWorkspace.id);
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    render(<MainTerminalArea />);

    // When: the first pane reports PTY cleanup from React unmount rather than process exit.
    const clearButtons = screen.getAllByTestId('terminal-unmount-pty');
    const firstClearButton = clearButtons[0];
    if (!firstClearButton) {
      throw new Error('Expected unmount button for pane-1.');
    }
    fireEvent.click(firstClearButton);

    // Then: the pane remains in the workspace and only its runtime PTY id is cleared.
    const updatedWorkspace = useWorkspaceStore.getState().workspaces[0];
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-1', 'pane-2']);
    expect(updatedWorkspace?.tabs[0]?.layout).toEqual(splitWorkspace.tabs[0]?.layout);
    expect(updatedWorkspace?.panes[0]?.ptyId).toBeUndefined();
  });

  it('keeps the pane mounted when close-pane-on-exit is turned off', () => {
    // Given: a tab with two panes and the close-pane-on-exit toggle disabled.
    const splitWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          id: 'tab-1',
          name: 'zsh',
          isCustomName: false,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'pane-1' },
              { type: 'leaf', paneId: 'pane-2' },
            ],
          },
          activePaneId: 'pane-1',
        },
      ],
      panes: [
        { id: 'pane-1', cwd: '/Users/tester/one', ptyId: 'pty-1' },
        { id: 'pane-2', cwd: '/Users/tester/two', ptyId: 'pty-2' },
      ],
    };
    setWorkspaces([splitWorkspace], splitWorkspace.id);
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        terminal: { ...DEFAULT_APP_SETTINGS.terminal, closePaneOnExit: false },
      },
    });
    render(<MainTerminalArea />);

    // When: the first pane's PTY exit is simulated.
    const clearButtons = screen.getAllByTestId('terminal-exit-pty');
    const firstClearButton = clearButtons[0];
    if (!firstClearButton) {
      throw new Error('Expected clear button for pane-1.');
    }
    fireEvent.click(firstClearButton);

    // Then: the pane stays in the layout; only its PTY id is cleared.
    const updatedWorkspace = useWorkspaceStore.getState().workspaces[0];
    expect(updatedWorkspace?.panes.map((pane) => pane.id)).toEqual(['pane-1', 'pane-2']);
    expect(updatedWorkspace?.panes[0]?.ptyId).toBeUndefined();
  });

  it('does not mark panes in inactive tabs as active terminals', () => {
    // Given: a second tab is active, so the first tab remains mounted but inactive.
    const twoTabWorkspace: Workspace = {
      ...workspace,
      tabs: [
        workspace.tabs[0]!,
        {
          id: 'tab-2',
          name: 'logs',
          isCustomName: false,
          layout: { type: 'leaf', paneId: 'pane-2' },
          activePaneId: 'pane-2',
        },
      ],
      panes: [...workspace.panes, { id: 'pane-2', cwd: '/Users/tester/logs' }],
      activeTabId: 'tab-2',
    };

    // When: the workspace renders with tab-1 inactive.
    setWorkspaces([twoTabWorkspace], twoTabWorkspace.id);
    render(<MainTerminalArea />);

    // Then: tab-1's terminal is not eligible for focus.
    const inactiveTerminal = screen
      .getByText('/Users/tester')
      .closest('[data-testid="terminal-view"]');
    expect(inactiveTerminal).toHaveAttribute('data-active', 'false');
  });

  it('maximizes the selected pane without unmounting sibling terminals', () => {
    // Given: the active tab has a split layout and pane-2 is fullscreen.
    const splitWorkspace: Workspace = {
      ...workspace,
      tabs: [
        {
          ...workspace.tabs[0]!,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              {
                type: 'leaf',
                paneId: 'pane-1',
              },
              {
                type: 'leaf',
                paneId: 'pane-2',
              },
            ],
          },
          activePaneId: 'pane-2',
        },
      ],
      panes: [
        {
          id: 'pane-1',
          cwd: '/Users/tester/one',
        },
        {
          id: 'pane-2',
          cwd: '/Users/tester/two',
        },
      ],
    };
    setWorkspaces([splitWorkspace], splitWorkspace.id);
    useUiStore.getState().setFullscreenPaneId('pane-2');

    // When: the layout renders in fullscreen mode.
    render(<MainTerminalArea />);

    // Then: both terminal components stay mounted, but only the fullscreen pane occupies the area.
    expect(screen.getAllByTestId('terminal-view')).toHaveLength(2);
    const fullscreenSection = screen.getByText('/Users/tester/two').closest('section');
    const hiddenSection = screen.getByText('/Users/tester/one').closest('section');
    expect(fullscreenSection).toHaveStyle({
      height: '100%',
      left: '0%',
      top: '0%',
      width: '100%',
    });
    expect(hiddenSection).toHaveClass('invisible', 'pointer-events-none');
    expect(
      screen.queryByRole('separator', { name: 'Resize vertical split' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit fullscreen (⌘⇧F)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Split pane vertically' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close pane' })).not.toBeInTheDocument();
  });

  it('ignores stale fullscreen pane ids that are not in the rendered tab layout', () => {
    // Given: a split layout is rendered while fullscreen state points at a missing pane.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    useUiStore.getState().setFullscreenPaneId('missing-pane');

    // When: the layout renders.
    render(<MainTerminalArea />);

    // Then: fullscreen is not applied to this tab.
    expect(screen.getByRole('separator', { name: 'Resize vertical split' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit fullscreen (⌘⇧F)' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Maximize pane' })).toHaveLength(2);
  });

  it('toggles fullscreen from the pane toolbar and makes that pane active', () => {
    // Given: the active tab has two panes and pane-1 is active.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    useWorkspaceStore.getState().setActivePane('pane-1');
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const secondPaneId = splitWorkspace?.panes.find((pane) => pane.id !== 'pane-1')?.id;
    if (!splitWorkspace || !secondPaneId) {
      throw new Error('Expected split workspace.');
    }

    // When: the second pane is maximized.
    render(<MainTerminalArea />);
    const secondMaximizeButton = screen.getAllByRole('button', { name: 'Maximize pane' })[1];
    if (!secondMaximizeButton) {
      throw new Error('Expected second maximize button.');
    }
    fireEvent.click(secondMaximizeButton);

    // Then: fullscreen state points at the second pane and that pane is active in workspace state.
    expect(useUiStore.getState().fullscreenPaneId).toBe(secondPaneId);
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs[0]?.activePaneId).toBe(secondPaneId);
  });
});
