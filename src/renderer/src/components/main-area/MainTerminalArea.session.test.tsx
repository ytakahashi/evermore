import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tab, Workspace } from '../../../../shared/types';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../../stores/workspaceStore';
import { MainTerminalArea } from './MainTerminalArea';

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

// Mock the terminal so the real PaneCell mounts a stable, identifiable node per pane without
// spinning up xterm or a PTY. The node identity is what proves React preserved the subtree.
const terminalUnmounts = vi.hoisted(() => vi.fn());
vi.mock('../terminal/TerminalView', () => ({
  TerminalView: ({ paneId }: { paneId?: string }) => {
    useEffect(
      () => () => {
        terminalUnmounts(paneId);
      },
      [paneId],
    );
    return <div data-testid={`terminal-${paneId}`} />;
  },
}));

const initialWorkspaceStoreState = useWorkspaceStore.getState();
const initialUiStoreState = useUiStore.getState();

function leafTab(id: string, paneId: string): Tab {
  return {
    id,
    name: id,
    isCustomName: false,
    layout: { type: 'leaf', paneId },
    activePaneId: paneId,
  };
}

describe('MainTerminalArea tab move keeps the session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalUnmounts.mockClear();
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          update: vi.fn(() => Promise.resolve()),
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
        },
      } as unknown as Window['api'],
    });

    const source: Workspace = {
      id: 'workspace-2',
      name: 'Project',
      rootPath: '/Users/tester',
      tabs: [leafTab('tab-a', 'pane-a'), leafTab('tab-b', 'pane-b')],
      panes: [
        { id: 'pane-a', cwd: '/Users/tester/a' },
        { id: 'pane-b', cwd: '/Users/tester/b' },
      ],
      activeTabId: 'tab-a',
      createdAt: 1,
      updatedAt: 1,
    };
    const active: Workspace = {
      id: 'workspace-1',
      name: 'Default',
      rootPath: '/Users/tester',
      tabs: [leafTab('tab-1', 'pane-1')],
      panes: [{ id: 'pane-1', cwd: '/Users/tester' }],
      activeTabId: 'tab-1',
      createdAt: 1,
      updatedAt: 1,
    };

    useWorkspaceStore.setState({
      workspaces: [active, source],
      activeWorkspaceId: 'workspace-1',
      isLoading: false,
      error: null,
      // Prevent the mount effect from calling the (unmocked) list IPC and clobbering this state.
      loadWorkspaces: vi.fn<WorkspaceStoreState['loadWorkspaces']>(() => Promise.resolve()),
    });
    useUiStore.setState({ fullscreenPaneId: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState(initialWorkspaceStoreState, true);
    useUiStore.setState(initialUiStoreState, true);
    Reflect.deleteProperty(window, 'api');
    vi.useRealTimers();
  });

  it('preserves the moved tab terminal node when it moves to another workspace', () => {
    // Given: the moved pane's terminal node is mounted (in a non-active workspace).
    render(<MainTerminalArea />);
    const terminalBefore = screen.getByTestId('terminal-pane-a');

    // When: the tab is moved from workspace-2 into the active workspace-1.
    act(() => {
      useWorkspaceStore.getState().moveTabToWorkspace('workspace-2', 'tab-a', 'workspace-1');
    });

    // Then: the tab kept its React identity across the move, so the same terminal node (and thus its
    // live PTY/xterm) survives rather than being unmounted and recreated.
    const terminalAfter = screen.getByTestId('terminal-pane-a');
    expect(terminalAfter).toBe(terminalBefore);
    // And: the tab now belongs to the destination workspace.
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs.map((tab) => tab.id)).toEqual([
      'tab-1',
      'tab-a',
    ]);
  });

  it('preserves pane terminal nodes when pane ownership changes between tabs', () => {
    // Given: two pane terminals are mounted as siblings in one source tab.
    const state = useWorkspaceStore.getState();
    const source = state.workspaces.find((workspace) => workspace.id === 'workspace-2');
    if (!source) {
      throw new Error('Expected source workspace.');
    }
    const splitSource: Workspace = {
      ...source,
      tabs: [
        {
          ...source.tabs[0]!,
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'pane-a' },
              { type: 'leaf', paneId: 'pane-c' },
            ],
          },
        },
        source.tabs[1]!,
      ],
      panes: [...source.panes, { id: 'pane-c', cwd: '/Users/tester/c' }],
    };
    useWorkspaceStore.setState({
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === splitSource.id ? splitSource : workspace,
      ),
    });
    render(<MainTerminalArea />);
    const movedTerminalBefore = screen.getByTestId('terminal-pane-a');
    const siblingTerminalBefore = screen.getByTestId('terminal-pane-c');

    // When: pane-a becomes the only leaf of a new tab and pane-c remains in the source tab.
    act(() => {
      useWorkspaceStore.setState({
        workspaces: useWorkspaceStore.getState().workspaces.map((workspace) =>
          workspace.id === splitSource.id
            ? {
                ...workspace,
                tabs: [
                  { ...workspace.tabs[0]!, layout: { type: 'leaf', paneId: 'pane-c' } },
                  workspace.tabs[1]!,
                  leafTab('tab-c', 'pane-a'),
                ],
                activeTabId: 'tab-c',
              }
            : workspace,
        ),
      });
    });

    // Then: both terminals retain their DOM and React identities across the ownership change.
    expect(screen.getByTestId('terminal-pane-a')).toBe(movedTerminalBefore);
    expect(screen.getByTestId('terminal-pane-c')).toBe(siblingTerminalBefore);
    expect(terminalUnmounts).not.toHaveBeenCalled();
  });
});
