import { StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Api } from '../../../src/shared/api-types';
import type { Workspace } from '../../../src/shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/settings-defaults';
import { OpenProjectPalette } from '../../../src/renderer/src/components/projects/OpenProjectPalette';
import { TabSearchPalette } from '../../../src/renderer/src/components/main-area/TabSearchPalette';
import { MainTerminalArea } from '../../../src/renderer/src/components/main-area/MainTerminalArea';
import { WorkspacesView } from '../../../src/renderer/src/components/sidebar/WorkspacesView';
import { SettingsView } from '../../../src/renderer/src/components/settings/SettingsView';
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore';
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore';
import { useUiStore } from '../../../src/renderer/src/stores/uiStore';

const terminal = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), command: vi.fn() }));

// Fake the native terminal boundary; retain real pane rendering and store/UI transitions.
vi.mock('../../../src/renderer/src/components/terminal/TerminalView', () => ({
  TerminalView: function FakeTerminal({
    paneId,
    cwd,
    initialCommand,
  }: {
    paneId: string;
    cwd: string;
    initialCommand?: string;
  }) {
    useEffect(() => {
      terminal.mount(paneId, cwd);
      if (initialCommand) terminal.command(initialCommand);
      return () => {
        terminal.unmount(paneId);
      };
    }, [paneId, cwd, initialCommand]);
    return <div data-testid={`terminal-${paneId}`} />;
  },
}));
vi.mock('../../../src/renderer/src/stores/workspaceStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/src/stores/workspaceStore')>();
  return {
    ...actual,
    useWorkspaceStore: actual.createWorkspaceStore({
      workspaceApi: {
        list: (...args) => window.api.workspace.list(...args),
        get: (...args) => window.api.workspace.get(...args),
        create: (...args) => window.api.workspace.create(...args),
        update: (...args) => window.api.workspace.update(...args),
        delete: (...args) => window.api.workspace.delete(...args),
        move: (...args) => window.api.workspace.move(...args),
        setActiveWorkspaceId: (...args) => window.api.workspace.setActiveWorkspaceId(...args),
      },
      debounceMs: 0,
    }),
  };
});

function workspace(id: string, path: string, isOpen = true): Workspace {
  return {
    id,
    rootPath: path,
    name: id,
    kind: id === 'home' ? 'home' : 'project',
    isOpen,
    tabs: [
      {
        id: `${id}-tab`,
        name: 'shell',
        isCustomName: false,
        activePaneId: `${id}-pane`,
        layout: { type: 'leaf', paneId: `${id}-pane` },
      },
    ],
    panes: [{ id: `${id}-pane`, cwd: `${path}/subdir` }],
    activeTabId: `${id}-tab`,
    createdAt: 0,
    updatedAt: 0,
  };
}

const initialWorkspace = useWorkspaceStore.getState();
const initialSettings = useSettingsStore.getState();
const initialUi = useUiStore.getState();
let api: Api['workspace'];
let saved: Workspace[];

beforeEach(async () => {
  saved = [workspace('home', '/home')];
  api = {
    list: vi.fn(async () => ({ workspaces: saved, activeWorkspaceId: 'home' })),
    get: vi.fn(async (id) => saved.find((entry) => entry.id === id) ?? null),
    create: vi.fn(async (name, path) => {
      const created = { ...workspace('new', path), name, panes: [{ id: 'new-pane', cwd: path }] };
      saved = [...saved, created];
      return created;
    }),
    update: vi.fn(async (updated) => {
      saved = saved.map((entry) => (entry.id === updated.id ? updated : entry));
    }),
    delete: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    setActiveWorkspaceId: vi.fn(async () => {}),
  };
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { workspace: api, window: { confirmCloseWorkspace: vi.fn(async () => true) } },
  });
  useSettingsStore.setState({
    settings: { ...DEFAULT_APP_SETTINGS, projects: { directories: ['/projects/evermore'] } },
    isLoading: false,
    error: null,
  });
  useUiStore.setState({ ...initialUi, projectPaletteOpen: true, activeView: 'settings' });
  await useWorkspaceStore.getState().loadWorkspaces();
  terminal.mount.mockClear();
  terminal.unmount.mockClear();
  terminal.command.mockClear();
});

afterEach(async () => {
  cleanup();
  // Drain reopen persistence before removing the preload fake.
  await new Promise((resolve) => setTimeout(resolve, 5));
  useWorkspaceStore.setState(initialWorkspace, true);
  useSettingsStore.setState(initialSettings, true);
  useUiStore.setState(initialUi, true);
  Reflect.deleteProperty(window, 'api');
});

describe('opening projects', () => {
  it('creates once and reuses the existing terminal when selected again', async () => {
    // Given: a registered project, real pane ownership, and the picker over Settings.
    render(
      <>
        <MainTerminalArea />
        <OpenProjectPalette />
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Search projects' });
    expect(input).toHaveFocus();

    await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false'));

    // When: the user selects the directory and later selects it again.
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().projectPaletteOpen).toBe(false));
    const owner = screen.getByTestId('terminal-new-pane');
    act(() => useUiStore.getState().openProjectPalette());
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().projectPaletteOpen).toBe(false));

    // Then: creation and terminal mounting happen once; active terminal identity survives.
    expect(api.create).toHaveBeenCalledExactlyOnceWith('evermore', '/projects/evermore');
    expect(screen.getByTestId('terminal-new-pane')).toBe(owner);
    expect(terminal.mount.mock.calls.filter(([id]) => id === 'new-pane')).toHaveLength(1);
    expect(terminal.unmount).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('mounts closed project panes only after reopening with their saved cwd', async () => {
    // Given: an unregistered closed project retains a saved layout and pane cwd.
    const closed = workspace('closed', '/projects/closed', false);
    saved = [...saved, closed];
    useWorkspaceStore.setState({ workspaces: saved });
    useSettingsStore.setState({
      settings: { ...DEFAULT_APP_SETTINGS, projects: { directories: [] } },
    });
    render(
      <>
        <MainTerminalArea />
        <OpenProjectPalette />
      </>,
    );
    expect(screen.queryByTestId('terminal-closed-pane')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false'));

    // When: the closed project is selected.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().projectPaletteOpen).toBe(false));

    // Then: the same layout is persisted open and its terminal starts at the saved cwd.
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'closed',
        isOpen: true,
        tabs: closed.tabs,
        panes: closed.panes,
      }),
    );
    expect(terminal.mount).toHaveBeenCalledWith('closed-pane', '/projects/closed/subdir');
  });

  it('opens the actual Projects settings section from an empty picker', () => {
    // Given: no registered or durable projects, and another Settings section is selected.
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    useUiStore.getState().openSettings('projects');
    render(
      <>
        <SettingsView />
        <OpenProjectPalette />
      </>,
    );
    act(() => useUiStore.getState().openSettings('shortcuts'));

    // When: the empty state link is selected.
    fireEvent.click(screen.getByRole('button', { name: 'Open Projects settings' }));

    // Then: the actual Projects section becomes visible and the picker closes.
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Add directory…' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cancels without bubbling Escape and restores the originating focus under StrictMode', () => {
    // Given: the picker is opened over Agents from a focused button under application StrictMode.
    act(() => useUiStore.setState({ projectPaletteOpen: false, activeView: 'agents' }));
    const escaped = vi.fn();
    render(
      <StrictMode>
        <div onKeyDown={escaped}>
          <button type="button">Origin</button>
          <OpenProjectPalette />
        </div>
      </StrictMode>,
    );
    screen.getByRole('button', { name: 'Origin' }).focus();
    act(() => useUiStore.getState().openProjectPalette());

    // When: IME cancellation is followed by a normal Escape inside the picker.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(escaped).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    // Then: only the picker closes, preserving the backing view and focus.
    expect(escaped).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeView).toBe('agents');
    expect(screen.getByRole('button', { name: 'Origin' })).toHaveFocus();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('ignores IME Enter and does not navigate when an opening request completes after cancellation', async () => {
    // Given: creation is deferred and the picker is over Settings.
    let finish!: (project: Workspace) => void;
    api.create = vi.fn(
      () =>
        new Promise<Workspace>((resolve) => {
          finish = resolve;
        }),
    );
    render(<OpenProjectPalette />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(api.create).not.toHaveBeenCalled();

    // When: selection starts, is submitted again, then canceled before IPC completes.
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => finish(workspace('new', '/projects/evermore')));

    // Then: the durable result is retained without replacing the current view.
    expect(api.create).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('home');
    expect(useUiStore.getState().activeView).toBe('settings');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps errors actionable and retries a failed create', async () => {
    // Given: creation fails once.
    vi.mocked(api.create).mockRejectedValueOnce(new Error('Disk unavailable'));
    render(<OpenProjectPalette />);

    // When: the user selects a project, sees the error, and retries.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await screen.findByRole('alert');
    expect(useUiStore.getState().activeView).toBe('settings');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().projectPaletteOpen).toBe(false));

    // Then: the retry succeeds and switches to the project.
    expect(api.create).toHaveBeenCalledTimes(2);
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('replaces tab search without preserving a previous project query', () => {
    // Given: both pickers are mounted with project search initially open.
    render(
      <>
        <OpenProjectPalette />
        <TabSearchPalette />
      </>,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } });
    expect(screen.getByText('No projects match')).toBeInTheDocument();

    // When: tab search replaces project search and project search opens again.
    act(() => useUiStore.getState().openTabSearch());
    expect(screen.getByRole('combobox', { name: 'Search tabs by tab name' })).toHaveFocus();
    act(() => useUiStore.getState().openProjectPalette());

    // Then: only the fresh project picker is open and focused.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Search projects' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Search projects' })).toHaveFocus();
  });

  it('closes a pending picker when another view is opened and retains the current workspace', async () => {
    // Given: project creation is still in flight.
    let finish!: (project: Workspace) => void;
    api.create = vi.fn(
      () =>
        new Promise<Workspace>((resolve) => {
          finish = resolve;
        }),
    );
    render(<OpenProjectPalette />);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    // When: navigation to Agents supersedes the picker before creation finishes.
    act(() => useUiStore.getState().openAgents());
    await act(async () => finish(workspace('new', '/projects/evermore')));

    // Then: the result is retained but the new view and previous workspace remain selected.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe('agents');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('home');
  });

  it('focuses the existing search on repeated Open Project without resetting its query', () => {
    // Given: a picker with a query and focus on a result.
    render(<OpenProjectPalette />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ever' } });
    screen.getByRole('option').focus();

    // When: Open Project is invoked again.
    act(() => useUiStore.getState().openProjectPalette());

    // Then: the input is focused and retains the in-progress query.
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByRole('combobox')).toHaveValue('ever');
  });

  it('distinguishes initial loading from an empty list and supports load-error retry', async () => {
    // Given: settings have not loaded, with a preload fake available for retry.
    const settingsApi = { get: vi.fn().mockResolvedValue(DEFAULT_APP_SETTINGS) };
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { workspace: api, settings: settingsApi },
    });
    useSettingsStore.setState({ settings: null, error: null, isLoading: true });
    render(<OpenProjectPalette />);
    expect(screen.getByText('Loading projects…')).toBeInTheDocument();
    expect(screen.queryByText('No projects registered yet')).not.toBeInTheDocument();

    // When: initial loading fails, then the user retries.
    act(() => useSettingsStore.setState({ isLoading: false, error: 'Read failed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Read failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    // Then: successful retry reaches the actual empty-project state.
    await screen.findByRole('button', { name: 'Open Projects settings' });
    expect(settingsApi.get).toHaveBeenCalledOnce();
  });

  it('offers every result with wrapping arrow navigation and a focus boundary', () => {
    // Given: more candidates than the old tab picker's result cap.
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        projects: { directories: Array.from({ length: 20 }, (_, i) => `/repo/${i}`) },
      },
    });
    render(<OpenProjectPalette />);
    const input = screen.getByRole('combobox');

    // When: the user wraps upward and presses Tab.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Tab' });

    // Then: all results are reachable and keyboard focus stays inside the picker.
    expect(screen.getAllByRole('option')).toHaveLength(20);
    expect(screen.getAllByRole('option')[19]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();
  });
});

describe('closing and reopening projects', () => {
  it('closes every project terminal, retains other owners, and restores layout/cwd without startup commands', async () => {
    // Given: two tabs and a split in a live project, alongside a home terminal.
    const project = workspace('project', '/projects/evermore');
    project.tabs[0]!.layout = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.4,
      children: [
        { type: 'leaf', paneId: 'project-pane' },
        { type: 'leaf', paneId: 'split-pane' },
      ],
    };
    project.tabs.push({
      id: 'second-tab',
      name: 'Second',
      isCustomName: true,
      layout: { type: 'leaf', paneId: 'second-pane' },
      activePaneId: 'second-pane',
    });
    project.panes[0]!.initialCommand = 'ssh example';
    project.panes.push(
      { id: 'split-pane', cwd: '/projects/evermore/src' },
      { id: 'second-pane', cwd: '/elsewhere' },
    );
    saved.push(project);
    useWorkspaceStore.setState({ workspaces: saved, activeWorkspaceId: project.id });
    useUiStore.setState({ projectPaletteOpen: false, activeView: 'workspace' });
    render(
      <>
        <WorkspacesView />
        <MainTerminalArea />
        <OpenProjectPalette />
      </>,
    );
    await waitFor(() => expect(useWorkspaceStore.getState().isLoading).toBe(false));
    act(() => useWorkspaceStore.getState().setActiveWorkspace(project.id));
    const homeOwner = screen.getByTestId('terminal-home-pane');
    expect(terminal.command).toHaveBeenCalledExactlyOnceWith('ssh example');
    terminal.mount.mockClear();
    terminal.unmount.mockClear();
    terminal.command.mockClear();

    // When: the sidebar closes the project, state saves, and the application reloads its workspaces.
    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: project.id, isOpen: false }),
      ),
    );
    await act(async () => useWorkspaceStore.getState().loadWorkspaces());

    // Then: all three project terminals unmount, home stays alive, and closed state survives reload.
    expect(
      terminal.unmount.mock.calls
        .map(([id]) => id)
        .sort((left: string, right: string) => left.localeCompare(right)),
    ).toEqual(['project-pane', 'second-pane', 'split-pane']);
    expect(screen.getByTestId('terminal-home-pane')).toBe(homeOwner);
    expect(terminal.mount).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('home');

    // When: Open Project reopens the retained project.
    act(() => useUiStore.getState().openProjectPalette());
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().projectPaletteOpen).toBe(false));

    // Then: original IDs, split ratio, selection and cwd return as fresh shells.
    const reopened = useWorkspaceStore
      .getState()
      .workspaces.find((entry) => entry.id === project.id)!;
    expect(reopened.tabs).toEqual(project.tabs);
    expect(reopened.activeTabId).toBe(project.activeTabId);
    expect(terminal.mount.mock.calls).toEqual([
      ['project-pane', '/projects/evermore/subdir'],
      ['split-pane', '/projects/evermore/src'],
      ['second-pane', '/elsewhere'],
    ]);
    expect(terminal.command).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByTestId('terminal-home-pane')).toBe(homeOwner);
  });

  it('keeps every terminal alive when workspace close is cancelled', async () => {
    // Given: always-confirm policy and a native sheet that cancels.
    const project = workspace('project', '/projects/evermore');
    saved.push(project);
    useWorkspaceStore.setState({ workspaces: saved, activeWorkspaceId: project.id });
    useUiStore.setState({ projectPaletteOpen: false, activeView: 'workspace' });
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        app: { ...DEFAULT_APP_SETTINGS.app, tabCloseConfirm: 'always' },
      },
    });
    vi.mocked(window.api.window.confirmCloseWorkspace).mockResolvedValue(false);
    render(
      <>
        <WorkspacesView />
        <MainTerminalArea />
      </>,
    );
    await waitFor(() => expect(useWorkspaceStore.getState().isLoading).toBe(false));
    act(() => useWorkspaceStore.getState().setActiveWorkspace(project.id));
    const owner = screen.getByTestId('terminal-project-pane');
    // When: close is requested and cancelled.
    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));
    await act(async () => {
      await Promise.resolve();
    });
    // Then: state and terminal ownership remain intact.
    expect(window.api.window.confirmCloseWorkspace).toHaveBeenCalledWith({
      runningProcesses: false,
    });
    expect(screen.getByTestId('terminal-project-pane')).toBe(owner);
    expect(terminal.unmount).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(project.id);
    expect(api.update).not.toHaveBeenCalled();
  });
});
