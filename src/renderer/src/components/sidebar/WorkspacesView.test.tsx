import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { WorkspacesView } from './WorkspacesView';

const workspace1: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'workspace-1-tab-1',
      name: 'zsh',
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
      name: 'server',
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
      name: 'logs',
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
      ptyId: 'pty-server',
    },
    {
      id: 'workspace-2-pane-2',
      cwd: '/Users/tester/project',
    },
    {
      id: 'workspace-2-pane-3',
      cwd: '/Users/tester/project/logs',
    },
  ],
  activeTabId: 'workspace-2-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

const newWorkspace: Workspace = {
  id: 'workspace-new',
  name: 'New',
  rootPath: '/Users/tester/new',
  tabs: [
    {
      id: 'workspace-new-tab-1',
      name: 'zsh',
      layout: {
        type: 'leaf',
        paneId: 'workspace-new-pane-1',
      },
      activePaneId: 'workspace-new-pane-1',
    },
  ],
  panes: [
    {
      id: 'workspace-new-pane-1',
      cwd: '/Users/tester/new',
    },
  ],
  activeTabId: 'workspace-new-tab-1',
  createdAt: 2,
  updatedAt: 2,
};

describe('WorkspacesView', () => {
  let workspaceCreate: ReturnType<typeof vi.fn<() => Promise<Workspace>>>;
  let workspaceDelete: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let workspaceUpdate: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    workspaceCreate = vi.fn(() => Promise.resolve(newWorkspace));
    workspaceDelete = vi.fn(() => Promise.resolve());
    workspaceUpdate = vi.fn(() => Promise.resolve());
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          create: workspaceCreate,
          delete: workspaceDelete,
          update: workspaceUpdate,
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
        },
      } as unknown as Window['api'],
    });
    useWorkspaceStore.setState({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: workspace1.id,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
    vi.useRealTimers();
  });

  it('renders workspace tabs with pane counts, pane details, and active state', () => {
    // Given: multiple workspaces and tabs are loaded.

    // When: the workspace sidebar renders.
    render(<WorkspacesView />);

    // Then: each workspace tab is listed with a leaf-pane count and pane cwd details.
    expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'zsh (1 pane)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'server (2 panes)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'logs (1 pane)' })).toBeInTheDocument();
    expect(screen.getByText('/Users/tester')).toBeInTheDocument();
    expect(screen.getAllByText('/Users/tester/project')).toHaveLength(2);
    expect(screen.getByText('/Users/tester/project/logs')).toBeInTheDocument();
  });

  it('shows running pane info when runtime state is available', () => {
    // Given: one pane has a PTY runtime info snapshot.
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-server': {
          ptyId: 'pty-server',
          activity: 'running',
          foregroundCommand: 'pnpm run dev',
          observedAt: 1000,
        },
      },
      isLoading: false,
      error: null,
    });

    // When: the workspace sidebar renders.
    render(<WorkspacesView />);

    // Then: the running command appears once as the summary label (cwd remains in the detail row).
    expect(screen.getByText('pnpm run dev')).toBeInTheDocument();
    expect(screen.getByLabelText('running')).toBeInTheDocument();
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

  it('creates a workspace from the inline input and calls the API', async () => {
    // Given: the sidebar is rendered with two workspaces.
    render(<WorkspacesView />);

    // When: the user opens the create input and submits a name.
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const input = screen.getByPlaceholderText('Workspace name');
    fireEvent.change(input, { target: { value: 'My Project' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // workspaceCreate is invoked synchronously inside the async createWorkspace action.
    expect(workspaceCreate).toHaveBeenCalledWith('My Project', '');

    // Flush the resolved Promise so the store's setState completes.
    await vi.advanceTimersByTimeAsync(0);

    // Then: the new workspace appears in the sidebar and becomes active.
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(3);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('workspace-new');
  });

  it('uses the default name when the create input is submitted empty', async () => {
    // Given: the sidebar is rendered.
    render(<WorkspacesView />);

    // When: the user opens the create input and presses Enter without typing.
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const input = screen.getByPlaceholderText('Workspace name');
    fireEvent.keyDown(input, { key: 'Enter' });

    // Then: the default name is sent to the API.
    expect(workspaceCreate).toHaveBeenCalledWith('Workspace', '');
  });

  it('cancels workspace creation with Escape and does not call the API', async () => {
    // Given: the create input is shown.
    render(<WorkspacesView />);
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const input = screen.getByPlaceholderText('Workspace name');
    fireEvent.change(input, { target: { value: 'Draft' } });

    // When: Escape is pressed.
    fireEvent.keyDown(input, { key: 'Escape' });

    // Then: the input disappears without creating a workspace.
    expect(screen.queryByPlaceholderText('Workspace name')).not.toBeInTheDocument();
    expect(workspaceCreate).not.toHaveBeenCalled();
  });

  it('cancels workspace creation when the input loses focus without Enter/Escape', () => {
    // Given: the create input is open with a draft.
    render(<WorkspacesView />);
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const input = screen.getByPlaceholderText('Workspace name');
    fireEvent.change(input, { target: { value: 'Draft' } });

    // When: the input loses focus without an explicit confirmation.
    fireEvent.blur(input);

    // Then: no workspace is created.
    expect(workspaceCreate).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Workspace name')).not.toBeInTheDocument();
  });

  it('does not create a workspace when Escape fires a blur on DOM removal', async () => {
    // Given: the create input is open.
    render(<WorkspacesView />);
    fireEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const input = screen.getByPlaceholderText('Workspace name');
    fireEvent.change(input, { target: { value: 'Draft' } });

    // When: Escape is pressed and a blur fires immediately after (simulating browser DOM removal).
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    // Then: no workspace is created.
    expect(workspaceCreate).not.toHaveBeenCalled();
  });

  it('renames a workspace with Enter and persists the new name', async () => {
    // Given: the sidebar shows two workspaces.
    render(<WorkspacesView />);

    // When: the user double-clicks to rename and confirms with Enter.
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Default' }));
    const input = screen.getByRole('textbox', { name: 'Rename Default' });
    fireEvent.change(input, { target: { value: '  Renamed  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(300);

    // Then: the trimmed name is shown and persisted.
    expect(screen.getByRole('button', { name: 'Renamed' })).toBeInTheDocument();
    expect(workspaceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'workspace-1', name: 'Renamed' }),
    );
  });

  it('cancels workspace rename with Escape and does not persist', async () => {
    // Given: the rename input is open.
    render(<WorkspacesView />);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Default' }));
    const input = screen.getByRole('textbox', { name: 'Rename Default' });
    fireEvent.change(input, { target: { value: 'Changed' } });

    // When: Escape is pressed followed by the blur that browsers fire on DOM removal.
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await vi.advanceTimersByTimeAsync(300);

    // Then: the original name is preserved and no update is persisted.
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(workspaceUpdate).not.toHaveBeenCalled();
  });

  it('deletes a workspace when confirmed and switches active to the first remaining', async () => {
    // Given: the confirmation dialog accepts automatically.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<WorkspacesView />);

    // When: the delete button for the active workspace is clicked.
    const deleteButton = screen.getByRole('button', { name: 'Delete Default' });
    fireEvent.click(deleteButton);

    // workspaceDelete is invoked synchronously inside the async deleteWorkspace action.
    expect(workspaceDelete).toHaveBeenCalledWith('workspace-1');

    // Flush the resolved Promise so the store's setState completes.
    await vi.advanceTimersByTimeAsync(0);

    // Then: the workspace is removed and the remaining one becomes active.
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('workspace-2');
  });

  it('does not delete when the confirmation dialog is dismissed', async () => {
    // Given: the confirmation dialog rejects.
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<WorkspacesView />);

    // When: the delete button is clicked but the user cancels.
    fireEvent.click(screen.getByRole('button', { name: 'Delete Default' }));

    // Then: nothing is deleted.
    expect(workspaceDelete).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  it('disables the delete button when only one workspace remains', () => {
    // Given: a single workspace is loaded.
    useWorkspaceStore.setState({ workspaces: [workspace1], activeWorkspaceId: workspace1.id });
    render(<WorkspacesView />);

    // When: the sidebar renders.
    const deleteButton = screen.getByRole('button', { name: 'Delete Default' });

    // Then: the delete button is disabled to prevent removing the last workspace.
    expect(deleteButton).toBeDisabled();
  });
});
