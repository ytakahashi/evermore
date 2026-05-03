import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TabBar } from './TabBar';

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

describe('TabBar', () => {
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

  it('renders the active tab and disables closing the final tab', () => {
    // Given: the current workspace has one tab.

    // When: the tab bar renders.
    render(<TabBar />);

    // Then: the active tab is shown and the close action is disabled.
    expect(screen.getByRole('button', { name: 'zsh' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Close zsh' })).toBeDisabled();
  });

  it('adds a tab from the new tab button', () => {
    // Given: the tab bar is connected to workspace state.
    render(<TabBar />);

    // When: the user creates a new tab.
    fireEvent.click(screen.getByRole('button', { name: 'New tab' }));

    // Then: a second tab appears and becomes active.
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'zsh' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'zsh' })[1]).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('selects and closes tabs', () => {
    // Given: the workspace has two tabs.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          tabs: [
            workspace.tabs[0],
            {
              id: 'tab-2',
              title: 'build',
              layout: {
                type: 'leaf',
                paneId: 'pane-2',
              },
              activePaneId: 'pane-2',
            },
          ],
          panes: [
            workspace.panes[0],
            {
              id: 'pane-2',
              cwd: '/Users/tester',
              title: 'build',
            },
          ],
        },
      ],
    });
    render(<TabBar />);

    // When: the second tab is selected and then closed.
    fireEvent.click(screen.getByRole('button', { name: 'build' }));

    // Then: tab selection is reflected in the accessible current-page state.
    expect(screen.getByRole('button', { name: 'build' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'zsh' })).not.toHaveAttribute('aria-current', 'page');

    // When: the selected tab is closed.
    fireEvent.click(screen.getByRole('button', { name: 'Close build' }));

    // Then: the closed tab is removed and the remaining tab becomes protected.
    expect(screen.queryByRole('button', { name: 'build' })).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaces[0]?.activeTabId).toBe('tab-1');
    expect(screen.getByRole('button', { name: 'Close zsh' })).toBeDisabled();
  });
});
