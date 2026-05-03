import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { PaneLayout } from './PaneLayout';

vi.mock('../terminal/TerminalView', () => ({
  TerminalView: ({ cwd }: { cwd?: string }) => <div data-testid="terminal-view">{cwd}</div>,
}));

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'tab-1',
      title: 'zsh',
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
      title: 'zsh',
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
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
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
      <PaneLayout layout={currentTab.layout} panes={currentWorkspace.panes} tab={currentTab} />,
    );

    // Then: one terminal is shown with the pane cwd.
    expect(screen.getByTestId('terminal-view')).toHaveTextContent('/Users/tester');
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
      <PaneLayout layout={currentTab.layout} panes={currentWorkspace.panes} tab={currentTab} />,
    );

    // When: the pane is split vertically.
    fireEvent.click(screen.getByRole('button', { name: 'Split pane vertically' }));
    const splitWorkspace = useWorkspaceStore.getState().workspaces[0];
    const splitTab = splitWorkspace?.tabs[0];
    if (!splitWorkspace || !splitTab) {
      throw new Error('Expected split workspace and tab.');
    }
    rerender(<PaneLayout layout={splitTab.layout} panes={splitWorkspace.panes} tab={splitTab} />);

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
    render(<PaneLayout layout={splitTab.layout} panes={splitWorkspace.panes} tab={splitTab} />);
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
});
