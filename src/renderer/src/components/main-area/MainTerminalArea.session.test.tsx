import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
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
          move: vi.fn(() => Promise.resolve()),
          update: vi.fn(() => Promise.resolve()),
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
        },
      } as unknown as Window['api'],
    });

    const source: Workspace = {
      id: 'workspace-2',
      name: 'Project',
      kind: 'project',
      isOpen: true,
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
      kind: 'home',
      isOpen: true,
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

  it.each([true, false])(
    'preserves terminal nodes when an active=%s project is reordered',
    (active) => {
      // Given: two projects with live terminal subtrees and explicit active selection.
      const source = useWorkspaceStore.getState().workspaces[1]!;
      const other: Workspace = {
        ...source,
        id: 'other',
        tabs: [leafTab('other-tab', 'other-pane')],
        panes: [{ id: 'other-pane', cwd: '/other' }],
        activeTabId: 'other-tab',
      };
      const activeWorkspaceId = active ? source.id : 'workspace-1';
      useWorkspaceStore.setState((state) => ({
        workspaces: [...state.workspaces, other],
        activeWorkspaceId,
      }));
      render(<MainTerminalArea />);
      const paneIds = ['pane-1', 'pane-a', 'pane-b', 'other-pane'];
      const before = paneIds.map((id) => screen.getByTestId(`terminal-${id}`));
      // When: the project moves past its neighbor via the real store action.
      act(() => {
        useWorkspaceStore.getState().moveWorkspace(source.id, other.id, 'after');
      });
      // Then: store and DOM order change while every terminal retains its identity and selection.
      expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id)).toEqual([
        'workspace-1',
        'other',
        'workspace-2',
      ]);
      expect(
        screen
          .getByTestId('terminal-other-pane')
          .compareDocumentPosition(screen.getByTestId('terminal-pane-a')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      before.forEach((node, index) =>
        expect(screen.getByTestId(`terminal-${paneIds[index]}`)).toBe(node),
      );
      expect(terminalUnmounts).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(activeWorkspaceId);
    },
  );

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

  it('preserves moved and sibling pane terminal nodes across createTabFromPane', () => {
    // Given: a two-pane tab (pane-a active, pane-b sibling) in the active workspace.
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Default',
          kind: 'home',
          isOpen: true,
          rootPath: '/Users/tester',
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
                  { type: 'leaf', paneId: 'pane-a' },
                  { type: 'leaf', paneId: 'pane-b' },
                ],
              },
              activePaneId: 'pane-a',
            },
          ],
          panes: [
            { id: 'pane-a', cwd: '/Users/tester/a' },
            { id: 'pane-b', cwd: '/Users/tester/b' },
          ],
          activeTabId: 'tab-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeWorkspaceId: 'workspace-1',
    });
    render(<MainTerminalArea />);
    const movedTerminalBefore = screen.getByTestId('terminal-pane-b');
    const siblingTerminalBefore = screen.getByTestId('terminal-pane-a');

    // When: the non-active pane is split out into a new tab via the real store action.
    act(() => {
      useWorkspaceStore.getState().createTabFromPane('workspace-1', 'tab-1', 'pane-b');
    });

    // Then: both the moved pane (now in the destination tab) and the sibling pane left behind in
    // the source tab keep their DOM/React identity, so neither terminal was unmounted.
    expect(screen.getByTestId('terminal-pane-b')).toBe(movedTerminalBefore);
    expect(screen.getByTestId('terminal-pane-a')).toBe(siblingTerminalBefore);
    expect(terminalUnmounts).not.toHaveBeenCalled();

    // And: switching between the source and destination tabs still doesn't unmount either node.
    const updatedWorkspace = useWorkspaceStore.getState().workspaces[0];
    const destinationTabId = updatedWorkspace?.tabs.find((tab) => tab.id !== 'tab-1')?.id;
    if (!destinationTabId) {
      throw new Error('Expected a destination tab to have been created.');
    }
    act(() => {
      useWorkspaceStore.getState().selectWorkspaceTab('workspace-1', 'tab-1');
    });
    act(() => {
      useWorkspaceStore.getState().selectWorkspaceTab('workspace-1', destinationTabId);
    });
    expect(screen.getByTestId('terminal-pane-b')).toBe(movedTerminalBefore);
    expect(screen.getByTestId('terminal-pane-a')).toBe(siblingTerminalBefore);
    expect(terminalUnmounts).not.toHaveBeenCalled();
  });
});
