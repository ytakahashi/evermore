import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tab, Workspace } from '../../../../shared/types';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../../stores/workspaceStore';
import { MainTerminalArea } from './MainTerminalArea';

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

// Mock the terminal so the real PaneLayout/PaneCell mount a stable, identifiable node per pane
// without spinning up xterm or a PTY. The node identity is what proves React preserved the subtree.
vi.mock('../terminal/TerminalView', () => ({
  TerminalView: ({ paneId }: { paneId?: string }) => <div data-testid={`terminal-${paneId}`} />,
}));

const initialWorkspaceStoreState = useWorkspaceStore.getState();
const initialUiStoreState = useUiStore.getState();

function leafTab(id: string, paneId: string): Tab {
  return { id, name: id, layout: { type: 'leaf', paneId }, activePaneId: paneId };
}

describe('MainTerminalArea tab move keeps the session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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
});
