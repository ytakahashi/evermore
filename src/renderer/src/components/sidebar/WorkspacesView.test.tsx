import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { WorkspacesView } from './WorkspacesView';

const workspace1: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'workspace-1-tab-1',
      title: 'zsh',
      layout: {
        type: 'leaf',
        paneId: 'workspace-1-pane-1',
      },
      activePaneId: 'workspace-1-pane-1',
    },
  ],
  panes: [
    {
      id: 'workspace-1-pane-1',
      cwd: '/Users/tester',
      title: 'zsh',
    },
  ],
  activeTabId: 'workspace-1-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

const workspace2: Workspace = {
  id: 'workspace-2',
  name: 'Project',
  rootPath: '/Users/tester/project',
  tabs: [
    {
      id: 'workspace-2-tab-1',
      title: 'server',
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          {
            type: 'leaf',
            paneId: 'workspace-2-pane-1',
          },
          {
            type: 'leaf',
            paneId: 'workspace-2-pane-2',
          },
        ],
      },
      activePaneId: 'workspace-2-pane-2',
    },
    {
      id: 'workspace-2-tab-2',
      title: 'logs',
      layout: {
        type: 'leaf',
        paneId: 'workspace-2-pane-3',
      },
      activePaneId: 'workspace-2-pane-3',
    },
  ],
  panes: [
    {
      id: 'workspace-2-pane-1',
      cwd: '/Users/tester/project',
      title: 'server',
    },
    {
      id: 'workspace-2-pane-2',
      cwd: '/Users/tester/project',
      title: 'server',
    },
    {
      id: 'workspace-2-pane-3',
      cwd: '/Users/tester/project/logs',
      title: 'logs',
    },
  ],
  activeTabId: 'workspace-2-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

describe('WorkspacesView', () => {
  let workspaceUpdate: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    workspaceUpdate = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          update: workspaceUpdate,
        },
      } as unknown as Window['api'],
    });
    useWorkspaceStore.setState({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: workspace1.id,
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

  it('renders workspace tabs with pane counts and active state', () => {
    // Given: multiple workspaces and tabs are loaded.

    // When: the workspace sidebar renders.
    render(<WorkspacesView />);

    // Then: each workspace tab is listed with a leaf-pane count.
    expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'zsh (1 pane)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'server (2 panes)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'logs (1 pane)' })).toBeInTheDocument();
  });

  it('selects the corresponding workspace and tab from the sidebar', async () => {
    // Given: the sidebar is showing an inactive workspace with tabs.
    render(<WorkspacesView />);

    // When: the user selects a tab from the inactive workspace.
    fireEvent.click(screen.getByRole('button', { name: 'logs (1 pane)' }));
    await vi.advanceTimersByTimeAsync(300);

    // Then: the store activates that workspace and tab for the main terminal area.
    const activeWorkspace = useWorkspaceStore
      .getState()
      .workspaces.find((workspace) => workspace.id === 'workspace-2');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('workspace-2');
    expect(activeWorkspace?.activeTabId).toBe('workspace-2-tab-2');
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'logs (1 pane)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(workspaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'workspace-2',
        activeTabId: 'workspace-2-tab-2',
      }),
    );
  });
});
