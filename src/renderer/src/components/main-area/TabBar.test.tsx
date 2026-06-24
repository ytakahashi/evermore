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

describe('TabBar', () => {
  let workspaceUpdate: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    workspaceUpdate = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          update: workspaceUpdate,
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
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
    expect(screen.getByRole('button', { name: 'tester' })).toHaveAttribute('aria-current', 'page');
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
              name: 'build',
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

  it('renames a tab with Enter and persists the new name', async () => {
    // Given: the tab bar is showing one editable tab.
    render(<TabBar />);

    // When: the user enters rename mode and confirms a new name.
    fireEvent.doubleClick(screen.getByRole('button', { name: 'zsh' }));
    const editor = screen.getByRole('textbox', { name: 'Rename zsh' });
    fireEvent.change(editor, { target: { value: '  server  ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(300);

    // Then: the trimmed name replaces the tab label and is persisted.
    expect(screen.getByRole('button', { name: 'server' })).toHaveAttribute('aria-current', 'page');
    expect(workspaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            id: 'tab-1',
            name: 'server',
          }),
        ],
      }),
    );
  });

  it('commits a tab rename on blur', async () => {
    // Given: the tab name editor is open.
    render(<TabBar />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'zsh' }));
    const editor = screen.getByRole('textbox', { name: 'Rename zsh' });

    // When: the user changes the title and moves focus away.
    fireEvent.change(editor, { target: { value: 'build' } });
    fireEvent.blur(editor);
    await vi.advanceTimersByTimeAsync(300);

    // Then: blur finalizes the rename.
    expect(screen.getByRole('button', { name: 'build' })).toBeInTheDocument();
    expect(workspaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tabs: [
          expect.objectContaining({
            id: 'tab-1',
            name: 'build',
          }),
        ],
      }),
    );
  });

  it('cancels tab rename with Escape and ignores blank names', async () => {
    // Given: the tab name editor is open.
    render(<TabBar />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'zsh' }));
    let editor = screen.getByRole('textbox', { name: 'Rename zsh' });

    // When: the user edits the draft and presses Escape.
    fireEvent.change(editor, { target: { value: 'server' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    await vi.advanceTimersByTimeAsync(300);

    // Then: the original name stays in place and no rename is persisted.
    expect(screen.getByRole('button', { name: 'zsh' })).toBeInTheDocument();
    expect(workspaceUpdate).not.toHaveBeenCalled();

    // When: the user submits a blank title.
    fireEvent.doubleClick(screen.getByRole('button', { name: 'zsh' }));
    editor = screen.getByRole('textbox', { name: 'Rename zsh' });
    fireEvent.change(editor, { target: { value: '   ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(300);

    // Then: the blank rename is discarded.
    expect(screen.getByRole('button', { name: 'zsh' })).toBeInTheDocument();
    expect(workspaceUpdate).not.toHaveBeenCalled();
  });

  it('does not commit a rename when blur fires after Escape', async () => {
    // Given: the tab name editor is open with a modified draft.
    render(<TabBar />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'zsh' }));
    const editor = screen.getByRole('textbox', { name: 'Rename zsh' });
    fireEvent.change(editor, { target: { value: 'server' } });

    // When: Escape is pressed and a blur event fires immediately after (as browsers do on DOM removal).
    fireEvent.keyDown(editor, { key: 'Escape' });
    fireEvent.blur(editor);
    await vi.advanceTimersByTimeAsync(300);

    // Then: the rename is discarded and the original name is preserved.
    expect(screen.getByRole('button', { name: 'zsh' })).toBeInTheDocument();
    expect(workspaceUpdate).not.toHaveBeenCalled();
  });

  it('does not open the right-click menu when no move command is actionable', () => {
    // Given: the only workspace has a single tab, so every move command would be disabled.
    render(<TabBar />);

    // When: the lone tab is right-clicked.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'zsh' }));

    // Then: no dead, all-disabled menu is shown.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('reorders a tab from its right-click menu', () => {
    // Given: the workspace has two tabs and the first is right-clicked.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          tabs: [
            workspace.tabs[0],
            {
              id: 'tab-2',
              name: 'build',
              layout: { type: 'leaf', paneId: 'pane-2' },
              activePaneId: 'pane-2',
            },
          ],
          panes: [workspace.panes[0], { id: 'pane-2', cwd: '/Users/tester' }],
        },
      ],
    });
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'zsh' }));

    // When: "Move right" is chosen.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move right' }));

    // Then: the first tab moves after the second and the menu closes.
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs.map((tab) => tab.id)).toEqual([
      'tab-2',
      'tab-1',
    ]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves a tab to another workspace from its right-click menu', () => {
    // Given: a two-tab workspace plus a second workspace to receive the tab.
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          tabs: [
            workspace.tabs[0],
            {
              id: 'tab-2',
              name: 'build',
              layout: { type: 'leaf', paneId: 'pane-2' },
              activePaneId: 'pane-2',
            },
          ],
          panes: [workspace.panes[0], { id: 'pane-2', cwd: '/Users/tester' }],
        },
        {
          ...workspace,
          id: 'workspace-2',
          name: 'Project',
          tabs: [
            {
              id: 'tab-3',
              name: 'main',
              layout: { type: 'leaf', paneId: 'pane-3' },
              activePaneId: 'pane-3',
            },
          ],
          panes: [{ id: 'pane-3', cwd: '/Users/tester' }],
          activeTabId: 'tab-3',
        },
      ],
    });
    render(<TabBar />);
    fireEvent.contextMenu(screen.getByRole('button', { name: 'zsh' }));

    // When: the destination workspace is chosen from the menu.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Project' }));

    // Then: the tab leaves the active workspace and arrives in the destination.
    const [source, destination] = useWorkspaceStore.getState().workspaces;
    expect(source.tabs.map((tab) => tab.id)).toEqual(['tab-2']);
    expect(destination.tabs.map((tab) => tab.id)).toEqual(['tab-3', 'tab-1']);
    expect(destination.activeTabId).toBe('tab-1');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('workspace-2');
  });
});
