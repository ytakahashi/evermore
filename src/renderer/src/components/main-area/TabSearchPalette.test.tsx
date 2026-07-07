import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore, type WorkspaceStoreState } from '../../stores/workspaceStore';
import { createTabSearchEntries, filterTabSearchEntries, type TabSearchEntry } from './tabSearch';
import { TabSearchPalette } from './TabSearchPalette';

function createWorkspace(
  id: string,
  name: string,
  tabs: Array<{ id: string; name: string }>,
  activeTabId: string,
): Workspace {
  return {
    id,
    name,
    rootPath: `/tmp/${id}`,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      isCustomName: true,
      layout: { type: 'leaf', paneId: `pane-${tab.id}` },
      activePaneId: `pane-${tab.id}`,
    })),
    panes: tabs.map((tab) => ({ id: `pane-${tab.id}`, cwd: `/tmp/${id}` })),
    activeTabId,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('TabSearchPalette search helpers', () => {
  it('creates entries for every tab across all workspaces', () => {
    // Given: two loaded workspaces with one active tab in the second workspace.
    const workspaces = [
      createWorkspace('workspace-1', 'Backend', [{ id: 'tab-1', name: 'API Server' }], 'tab-1'),
      createWorkspace('workspace-2', 'Frontend', [{ id: 'tab-2', name: 'Client' }], 'tab-2'),
    ];

    // When: the tab search entries are flattened.
    const entries = createTabSearchEntries(workspaces, 'workspace-2');

    // Then: every tab is represented with workspace metadata and active-tab state.
    expect(entries).toEqual([
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Backend',
        tabId: 'tab-1',
        tabName: 'API Server',
        isActive: false,
      },
      {
        workspaceId: 'workspace-2',
        workspaceName: 'Frontend',
        tabId: 'tab-2',
        tabName: 'Client',
        isActive: true,
      },
    ]);
  });

  it('filters by tab name only and ignores workspace names', () => {
    // Given: a workspace name that matches the query but a tab name that does not.
    const entries: TabSearchEntry[] = [
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Backend API',
        tabId: 'tab-1',
        tabName: 'Shell',
        isActive: false,
      },
    ];

    // When: entries are filtered by a string that appears only in the workspace name.
    const filtered = filterTabSearchEntries(entries, 'api');

    // Then: no result is returned because the first iteration searches tab names only.
    expect(filtered).toEqual([]);
  });

  it('ranks exact and prefix tab-name matches before later substring matches', () => {
    // Given: tabs that all contain the same query at different positions.
    const entries: TabSearchEntry[] = [
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Backend',
        tabId: 'tab-1',
        tabName: 'Staging API',
        isActive: false,
      },
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Backend',
        tabId: 'tab-2',
        tabName: 'api',
        isActive: false,
      },
      {
        workspaceId: 'workspace-1',
        workspaceName: 'Backend',
        tabId: 'tab-3',
        tabName: 'API Server',
        isActive: false,
      },
    ];

    // When: entries are filtered by tab name.
    const filtered = filterTabSearchEntries(entries, 'api');

    // Then: exact match, prefix match, and substring match order is stable.
    expect(filtered.map((entry) => entry.tabId)).toEqual(['tab-2', 'tab-3', 'tab-1']);
  });
});

describe('TabSearchPalette', () => {
  let previousSelectWorkspaceTab: WorkspaceStoreState['selectWorkspaceTab'];
  let selectWorkspaceTab: ReturnType<typeof vi.fn<WorkspaceStoreState['selectWorkspaceTab']>>;

  beforeEach(() => {
    previousSelectWorkspaceTab = useWorkspaceStore.getState().selectWorkspaceTab;
    selectWorkspaceTab = vi.fn<WorkspaceStoreState['selectWorkspaceTab']>();
    useWorkspaceStore.setState({
      activeWorkspaceId: 'workspace-1',
      selectWorkspaceTab,
      workspaces: [
        createWorkspace(
          'workspace-1',
          'Backend',
          [
            { id: 'tab-1', name: 'API Server' },
            { id: 'tab-2', name: 'Worker Queue' },
          ],
          'tab-1',
        ),
        createWorkspace(
          'workspace-2',
          'Frontend API',
          [{ id: 'tab-3', name: 'Client Shell' }],
          'tab-3',
        ),
      ],
    });
    useUiStore.setState({ activeView: 'settings', tabSearchOpen: true });
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      activeWorkspaceId: null,
      selectWorkspaceTab: previousSelectWorkspaceTab,
      workspaces: [],
    });
    useUiStore.setState({ activeView: 'workspace', tabSearchOpen: false });
  });

  it('renders all workspace tabs and filters by tab name', () => {
    // Given: the palette is open with tabs from multiple workspaces.
    render(<TabSearchPalette />);

    // When: the user searches for a tab-name fragment.
    fireEvent.change(screen.getByRole('combobox', { name: 'Search tabs by tab name' }), {
      target: { value: 'api' },
    });

    // Then: matching tab names stay visible, while workspace-name-only matches are excluded.
    expect(screen.getByText('API Server')).toBeInTheDocument();
    expect(screen.queryByText('Client Shell')).not.toBeInTheDocument();
    expect(screen.queryByText('Worker Queue')).not.toBeInTheDocument();
  });

  it('selects the highlighted tab with Enter and returns to the workspace view', () => {
    // Given: the palette is open and all tabs are listed in workspace order.
    render(<TabSearchPalette />);
    const input = screen.getByRole('combobox', { name: 'Search tabs by tab name' });

    // When: the user moves to the second result and confirms it.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Then: the selected tab is requested, the palette closes, and the workspace view is visible.
    expect(selectWorkspaceTab).toHaveBeenCalledWith('workspace-1', 'tab-2');
    expect(useUiStore.getState().tabSearchOpen).toBe(false);
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('selects a clicked tab from another workspace', () => {
    // Given: the palette shows tabs from every workspace.
    render(<TabSearchPalette />);

    // When: the user clicks a tab that belongs to another workspace.
    fireEvent.click(screen.getByRole('option', { name: /Client Shell/ }));

    // Then: the cross-workspace tab selection request carries both ids.
    expect(selectWorkspaceTab).toHaveBeenCalledWith('workspace-2', 'tab-3');
    expect(useUiStore.getState().tabSearchOpen).toBe(false);
  });

  it('closes without selecting when Escape is pressed', () => {
    // Given: the palette is open.
    render(<TabSearchPalette />);

    // When: the user cancels with Escape.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search tabs by tab name' }), {
      key: 'Escape',
    });

    // Then: no tab is selected and the palette closes.
    expect(selectWorkspaceTab).not.toHaveBeenCalled();
    expect(useUiStore.getState().tabSearchOpen).toBe(false);
  });
});
