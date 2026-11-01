import { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { cloneDefaultSettings } from '../../../src/shared/settings-defaults';
import type { Workspace } from '../../../src/shared/types';
import { AgentsView } from '../../../src/renderer/src/components/agents/AgentsView';
import { LaunchAgentPalette } from '../../../src/renderer/src/components/agents/LaunchAgentPalette';
import { MainTerminalArea } from '../../../src/renderer/src/components/main-area/MainTerminalArea';
import { useUiStore } from '../../../src/renderer/src/stores/uiStore';
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore';
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore';
import { usePaneInfoStore } from '../../../src/renderer/src/stores/paneInfoStore';
import { terminalHostRegistry } from '../../../src/renderer/src/terminal-host/terminalHostRegistry';

const terminal = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn(), command: vi.fn() }));
// Replace only native terminal resources; retain actual pane ownership, borrowing, stores and views.
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
    const homeRef = useRef<HTMLDivElement>(null);
    const initial = useRef({ cwd, initialCommand });
    useEffect(() => {
      const home = homeRef.current!;
      const element = document.createElement('div');
      element.textContent = `Terminal ${paneId}`;
      home.appendChild(element);
      terminal.mount(paneId, initial.current.cwd);
      if (initial.current.initialCommand) terminal.command(paneId, initial.current.initialCommand);
      const unregister = terminalHostRegistry.register(paneId, { element, home, fit: () => {} });
      return () => {
        unregister();
        element.remove();
        terminal.unmount(paneId);
      };
    }, [paneId]);
    return <div ref={homeRef} data-testid={`terminal-owner-${paneId}`} />;
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

function workspace(id: string, rootPath: string): Workspace {
  return {
    id,
    name: id,
    kind: id === 'home' ? 'home' : 'project',
    rootPath,
    isOpen: true,
    tabs: [
      {
        id: `${id}-tab`,
        name: 'shell',
        isCustomName: false,
        activePaneId: `${id}-pane`,
        layout: { type: 'leaf', paneId: `${id}-pane` },
      },
    ],
    panes: [{ id: `${id}-pane`, cwd: rootPath }],
    activeTabId: `${id}-tab`,
    createdAt: 0,
    updatedAt: 0,
  };
}
function Harness(): React.JSX.Element {
  const view = useUiStore((state) => state.activeView);
  return (
    <>
      <div style={{ display: view === 'workspace' ? undefined : 'none' }}>
        <MainTerminalArea />
      </div>
      <AgentsView />
      <LaunchAgentPalette />
    </>
  );
}
const initialWorkspace = useWorkspaceStore.getState();
const initialSettings = useSettingsStore.getState();
const initialUi = useUiStore.getState();
const initialInfo = usePaneInfoStore.getState();
let saved: Workspace[];
let api: Window['api']['workspace'];

beforeEach(async () => {
  saved = [workspace('home', '/home')];
  api = {
    list: vi.fn(async () => ({ workspaces: structuredClone(saved), activeWorkspaceId: 'home' })),
    get: vi.fn(async () => null),
    create: vi.fn(async (name, rootPath) => {
      const created = { ...workspace('project', rootPath), name };
      saved.push(created);
      return created;
    }),
    update: vi.fn(async (updated) => {
      saved = saved.map((entry) => (entry.id === updated.id ? updated : entry));
    }),
    delete: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    setActiveWorkspaceId: vi.fn(async () => {}),
  };
  Object.defineProperty(window, 'api', { configurable: true, value: { workspace: api } });
  const settings = cloneDefaultSettings();
  settings.projects.directories = ['/work'];
  useSettingsStore.setState({ settings, isLoading: false, error: null });
  useUiStore.setState({ ...initialUi, activeView: 'agents' });
  usePaneInfoStore.setState({ infosByPtyId: {} });
  await useWorkspaceStore.getState().loadWorkspaces();
  terminal.mount.mockClear();
  terminal.unmount.mockClear();
  terminal.command.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(async () => {
  cleanup();
  // Drain debounced persistence before restoring the preload boundary.
  await new Promise((resolve) => setTimeout(resolve, 5));
  useWorkspaceStore.setState(initialWorkspace, true);
  useSettingsStore.setState(initialSettings, true);
  useUiStore.setState(initialUi, true);
  usePaneInfoStore.setState(initialInfo, true);
  Reflect.deleteProperty(window, 'api');
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

function chooseProjectAndPreset(): void {
  fireEvent.change(screen.getByRole('combobox', { name: 'Search projects' }), {
    target: { value: '/work' },
  });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search projects' }), { key: 'Enter' });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search presets' }), { key: 'Enter' });
}

describe('agent launch wiring', () => {
  it('creates a background project, selects after PTY readiness, and preserves existing terminals', async () => {
    // Given: Agents over home, with the real terminal ownership tree mounted behind it.
    render(<Harness />);
    await waitFor(() => expect(useWorkspaceStore.getState().isLoading).toBe(false));
    const homeOwner = screen.getByTestId('terminal-owner-home-pane');
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    // When: a registered project and preset are accepted.
    chooseProjectAndPreset();
    await waitFor(() => expect(useUiStore.getState().pendingAgentSelectionPaneId).not.toBeNull());
    const paneId = useUiStore.getState().pendingAgentSelectionPaneId!;
    // Then: the original shell and new command both mount without switching away from Agents/home.
    expect(api.create).toHaveBeenCalledExactlyOnceWith('work', '/work');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('home');
    expect(api.setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(terminal.command).toHaveBeenCalledExactlyOnceWith(paneId, 'claude');
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
    // When: native PTY creation completes, before any agent runtime info exists.
    act(() => useWorkspaceStore.getState().setPanePtyId(paneId, 'pty-new'));
    // Then: the existing terminal is borrowed and selected, without remounting any owner.
    const panel = await screen.findByRole('region', { name: 'Selected agent terminal' });
    expect(panel).toHaveTextContent(`Terminal ${paneId}`);
    expect(useUiStore.getState().pendingAgentSelectionPaneId).toBeNull();
    expect(useUiStore.getState().activeView).toBe('agents');
    expect(screen.getByTestId('terminal-owner-home-pane')).toBe(homeOwner);
    expect(terminal.unmount).not.toHaveBeenCalled();
    expect(terminal.mount.mock.calls.filter(([id]) => id === paneId)).toHaveLength(1);
    // When: the user opens the selected terminal in its workspace.
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));
    // Then: borrowing ends before navigation, while terminal ownership and command identity survive.
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('project');
    expect(screen.getByTestId(`terminal-owner-${paneId}`)).toHaveTextContent(`Terminal ${paneId}`);
    expect(terminal.unmount).not.toHaveBeenCalled();
    expect(terminal.command).toHaveBeenCalledTimes(1);
  });

  it.each(['settings', 'workspace'] as const)(
    'reveals and selects the launched pane from %s',
    async (origin) => {
      // Given: a non-Agents origin and its terminal owner tree.
      useUiStore.setState({ activeView: origin });
      render(<Harness />);
      await waitFor(() => expect(useWorkspaceStore.getState().isLoading).toBe(false));
      act(() => useUiStore.getState().openLaunchPalette());
      // When: project and preset are confirmed through the actual palette/store path.
      chooseProjectAndPreset();
      await waitFor(() => expect(useUiStore.getState().launchPaletteOpen).toBe(false));
      // Then: the new tab becomes active in the selected project and focus is requested there.
      const current = useWorkspaceStore
        .getState()
        .workspaces.find((entry) => entry.id === 'project')!;
      expect(current.tabs.find((tab) => tab.id === current.activeTabId)?.name).toBe('Claude Code');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('project');
      expect(useUiStore.getState().activeView).toBe('workspace');
      expect(useUiStore.getState().terminalFocusRequest).toBe(initialUi.terminalFocusRequest + 1);
      expect(terminal.unmount).not.toHaveBeenCalled();
    },
  );

  it('keeps a completed project create but does not launch or navigate after dismissal', async () => {
    // Given: a palette waiting on native project persistence.
    let finish!: (value: Workspace) => void;
    vi.mocked(api.create).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<Harness />);
    await waitFor(() => expect(useWorkspaceStore.getState().isLoading).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    chooseProjectAndPreset();
    // When: the user dismisses before native creation completes.
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search presets' }), { key: 'Escape' });
    await act(async () => {
      finish(workspace('project', '/work'));
    });
    // Then: only the durable initial shell remains, and the canceled continuation cannot navigate.
    expect(
      useWorkspaceStore.getState().workspaces.find((entry) => entry.id === 'project')?.tabs,
    ).toHaveLength(1);
    expect(terminal.command).not.toHaveBeenCalled();
    expect(useUiStore.getState()).toMatchObject({
      activeView: 'agents',
      pendingAgentSelectionPaneId: null,
      launchPaletteOpen: false,
    });
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('home');
    expect(api.setActiveWorkspaceId).not.toHaveBeenCalled();
  });
});
