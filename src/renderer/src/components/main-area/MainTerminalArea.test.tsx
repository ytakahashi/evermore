import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../../stores/workspaceStore';
import { MainTerminalArea } from './MainTerminalArea';

vi.mock('./TabBar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

vi.mock('./PaneLayout', () => ({
  PaneCell: ({ isActiveTab, tab }: { isActiveTab: boolean; tab: { id: string } }) => (
    <div data-active={isActiveTab ? 'true' : 'false'} data-testid={`pane-layout-${tab.id}`} />
  ),
  PaneSplitters: () => <div data-testid="pane-splitters" />,
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
    {
      id: 'tab-2',
      name: 'logs',
      isCustomName: false,
      layout: {
        type: 'leaf',
        paneId: 'pane-2',
      },
      activePaneId: 'pane-2',
    },
  ],
  panes: [
    {
      id: 'pane-1',
      cwd: '/Users/tester',
    },
    {
      id: 'pane-2',
      cwd: '/Users/tester/logs',
    },
  ],
  activeTabId: 'tab-1',
  createdAt: 1,
  updatedAt: 1,
};

describe('MainTerminalArea', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      isLoading: false,
      error: null,
      loadWorkspaces: vi.fn<WorkspaceStoreState['loadWorkspaces']>(() => Promise.resolve()),
    });
    useUiStore.setState({
      fullscreenPaneId: null,
    });
  });

  afterEach(() => {
    useWorkspaceStore.setState(initialWorkspaceStoreState, true);
    useUiStore.setState(initialUiStoreState, true);
  });

  it('clears fullscreen when the active tab changes', async () => {
    // Given: a pane is fullscreen in the first tab.
    useUiStore.getState().setFullscreenPaneId('pane-1');
    render(<MainTerminalArea />);
    expect(screen.getByTestId('pane-layout-tab-1')).toHaveAttribute('data-active', 'true');

    // When: the active tab changes.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          activeTabId: 'tab-2',
        },
      ],
    });

    // Then: the transient fullscreen state is reset.
    await waitFor(() => {
      expect(useUiStore.getState().fullscreenPaneId).toBeNull();
    });
  });

  it('clears fullscreen when a different pane in the same tab becomes active', async () => {
    // Given: pane-1 is fullscreen in a split active tab.
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
                paneId: 'pane-3',
              },
            ],
          },
          activePaneId: 'pane-1',
        },
        workspace.tabs[1]!,
      ],
      panes: [
        ...workspace.panes,
        {
          id: 'pane-3',
          cwd: '/Users/tester/other',
        },
      ],
    };
    useWorkspaceStore.setState({
      workspaces: [splitWorkspace],
    });
    useUiStore.getState().setFullscreenPaneId('pane-1');
    render(<MainTerminalArea />);

    // When: sidebar-style selection moves active focus to pane-3 while pane-1 remains in the tab.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...splitWorkspace,
          tabs: [
            {
              ...splitWorkspace.tabs[0]!,
              activePaneId: 'pane-3',
            },
            splitWorkspace.tabs[1]!,
          ],
        },
      ],
    });

    // Then: fullscreen is cleared so visible focus and workspace state cannot diverge.
    await waitFor(() => {
      expect(useUiStore.getState().fullscreenPaneId).toBeNull();
    });
  });

  it('clears fullscreen when the target pane leaves the active tab layout', async () => {
    // Given: fullscreen state points at the active tab's pane.
    useUiStore.getState().setFullscreenPaneId('pane-1');
    render(<MainTerminalArea />);

    // When: the active tab layout no longer contains that pane.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          tabs: [
            {
              ...workspace.tabs[0]!,
              layout: {
                type: 'leaf',
                paneId: 'pane-2',
              },
              activePaneId: 'pane-2',
            },
            workspace.tabs[1]!,
          ],
        },
      ],
    });

    // Then: stale fullscreen state is cleared without relying on workspace-store/ui-store coupling.
    await waitFor(() => {
      expect(useUiStore.getState().fullscreenPaneId).toBeNull();
    });
  });
});
