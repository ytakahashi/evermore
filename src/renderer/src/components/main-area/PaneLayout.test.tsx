import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneLayout } from './PaneLayout';

vi.mock('../terminal/TerminalView', () => ({
  TerminalView: ({
    cwd,
    isActive,
    onPtyIdChange,
  }: {
    cwd?: string;
    isActive?: boolean;
    onPtyIdChange?: (ptyId: string | null) => void;
  }) => (
    <div data-active={isActive ? 'true' : 'false'} data-testid="terminal-view">
      {cwd}
      {/* Test-only hook to simulate the PTY id lifecycle without spinning up a real terminal. */}
      <button data-testid="terminal-clear-pty" type="button" onClick={() => onPtyIdChange?.(null)}>
        clear pty
      </button>
    </div>
  ),
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

describe('PaneLayout', () => {
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
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({ fullscreenPaneId: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({ fullscreenPaneId: null });
    Reflect.deleteProperty(window, 'api');
    vi.useRealTimers();
  });

  it('renders a leaf terminal pane', () => {
    // Given: the current tab has one leaf pane.
    const currentWorkspace = useWorkspaceStore.getState().workspaces[0];
    const currentTab = currentWorkspace?.tabs[0];
    if (!currentWorkspace || !currentTab) {
      throw new Error('Expected test workspace and tab.');
    }

    // When: the layout renders.
    render(
      <PaneLayout
        isActiveTab
        layout={currentTab.layout}
        panes={currentWorkspace.panes}
        tab={currentTab}
      />,
    );

    // Then: one terminal is shown with the pane cwd.
    expect(screen.getByTestId('terminal-view')).toHaveTextContent('/Users/tester');
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: 'Maximize pane' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split pane vertically' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Split pane horizontally' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close pane' })).toBeDisabled();
  });

  it('splits and closes panes through toolbar actions', () => {
    // Given: the current tab has one leaf pane.
    const currentWorkspace = useWorkspaceStore.getState().workspaces[0];
    const currentTab = currentWorkspace?.tabs[0];
    if (!currentWorkspace || !currentTab) {
      throw new Error('Expected test workspace and tab.');
    }
    const { rerender } = render(
      <PaneLayout
        isActiveTab
        layout={currentTab.layout}
        panes={currentWorkspace.panes}
        tab={currentTab}
      />,
    );

    // When: the pane is split vertically.
    fireEvent.click(screen.getByRole('button', { name: 'Split pane vertically' }));
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const splitTab = splitWorkspace?.tabs[0];
    if (!splitWorkspace || !splitTab) {
      throw new Error('Expected split workspace and tab.');
    }
    rerender(
      <PaneLayout
        isActiveTab
        layout={splitTab.layout}
        panes={splitWorkspace.panes}
        tab={splitTab}
      />,
    );

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
    // Given: the current tab has a vertical split.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const splitTab = splitWorkspace?.tabs[0];
    if (!splitWorkspace || !splitTab) {
      throw new Error('Expected split workspace and tab.');
    }
    render(
      <PaneLayout
        isActiveTab
        layout={splitTab.layout}
        panes={splitWorkspace.panes}
        tab={splitTab}
      />,
    );
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
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          panes: [{ ...workspace.panes[0]!, ptyId: 'pty-1' }],
        },
      ],
      activeWorkspaceId: workspace.id,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': {
          ptyId: 'pty-1',
          activity: 'running',
          foregroundCommand: 'pnpm dev',
          observedAt: 1,
        },
      },
      isLoading: false,
      error: null,
    });
    const currentWorkspace = useWorkspaceStore.getState().workspaces[0];
    const currentTab = currentWorkspace?.tabs[0];
    if (!currentWorkspace || !currentTab) {
      throw new Error('Expected test workspace and tab.');
    }
    render(
      <PaneLayout
        isActiveTab
        layout={currentTab.layout}
        panes={currentWorkspace.panes}
        tab={currentTab}
      />,
    );

    // When: TerminalView reports the PTY id has been cleared.
    fireEvent.click(screen.getByTestId('terminal-clear-pty'));

    // Then: the renderer-side paneInfo cache no longer holds the dead PTY entry.
    expect(usePaneInfoStore.getState().infosByPtyId).toEqual({});
    expect(useWorkspaceStore.getState().workspaces[0]?.panes[0]?.ptyId).toBeUndefined();
  });

  it('does not mark panes in inactive tabs as active terminals', () => {
    // Given: a tab remains mounted while another tab is selected.
    const inactiveTab = {
      ...workspace.tabs[0],
      activePaneId: 'pane-1',
    };

    // When: the inactive tab layout renders.
    render(
      <PaneLayout
        isActiveTab={false}
        layout={inactiveTab.layout}
        panes={workspace.panes}
        tab={inactiveTab}
      />,
    );

    // Then: its terminal is not eligible for focus.
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-active', 'false');
  });

  it('maximizes the selected pane without unmounting sibling terminals', () => {
    // Given: the current tab has a split layout and pane-2 is fullscreen.
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
    useWorkspaceStore.setState({
      workspaces: [splitWorkspace],
      activeWorkspaceId: splitWorkspace.id,
      isLoading: false,
      error: null,
    });
    useUiStore.getState().setFullscreenPaneId('pane-2');
    const currentTab = splitWorkspace.tabs[0];
    if (!currentTab) {
      throw new Error('Expected test tab.');
    }

    // When: the layout renders in fullscreen mode.
    render(
      <PaneLayout
        isActiveTab
        layout={currentTab.layout}
        panes={splitWorkspace.panes}
        tab={currentTab}
      />,
    );

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
    expect(screen.getByRole('button', { name: 'Exit fullscreen (⌘Esc)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Split pane vertically' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close pane' })).not.toBeInTheDocument();
  });

  it('ignores stale fullscreen pane ids that are not in the rendered tab layout', () => {
    // Given: a split layout is rendered while fullscreen state points at a missing pane.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    useUiStore.getState().setFullscreenPaneId('missing-pane');
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const splitTab = splitWorkspace?.tabs[0];
    if (!splitWorkspace || !splitTab) {
      throw new Error('Expected split workspace and tab.');
    }

    // When: the layout renders.
    render(
      <PaneLayout
        isActiveTab
        layout={splitTab.layout}
        panes={splitWorkspace.panes}
        tab={splitTab}
      />,
    );

    // Then: fullscreen is not applied to this tab.
    expect(screen.getByRole('separator', { name: 'Resize vertical split' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Exit fullscreen (⌘Esc)' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Maximize pane' })).toHaveLength(2);
  });

  it('toggles fullscreen from the pane toolbar and makes that pane active', () => {
    // Given: the current tab has two panes and pane-1 is active.
    useWorkspaceStore.getState().splitPane('pane-1', 'vertical');
    useWorkspaceStore.getState().setActivePane('pane-1');
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const splitTab = splitWorkspace?.tabs[0];
    const secondPaneId = splitWorkspace?.panes.find((pane) => pane.id !== 'pane-1')?.id;
    if (!splitWorkspace || !splitTab || !secondPaneId) {
      throw new Error('Expected split workspace and tab.');
    }

    // When: the second pane is maximized.
    render(
      <PaneLayout
        isActiveTab
        layout={splitTab.layout}
        panes={splitWorkspace.panes}
        tab={splitTab}
      />,
    );
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
