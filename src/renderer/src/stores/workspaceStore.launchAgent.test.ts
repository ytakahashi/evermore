import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AgentPreset, Workspace } from '../../../shared/types';
import {
  MAX_WORKSPACE_NAME_LENGTH,
  MAX_WORKSPACE_PANES,
  MAX_WORKSPACE_TABS,
} from '../../../shared/workspace-constants';
import { createWorkspaceStore } from './workspaceStore';

const preset: AgentPreset = { id: 'custom', label: 'Agent', command: '  codex "$HOME"  ' };
function workspace(id: string, rootPath = '/work'): Workspace {
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
        layout: { type: 'leaf', paneId: `${id}-pane` },
        activePaneId: `${id}-pane`,
      },
    ],
    panes: [{ id: `${id}-pane`, cwd: rootPath }],
    activeTabId: `${id}-tab`,
    createdAt: 0,
    updatedAt: 0,
  };
}
function setup(project = workspace('project')): {
  store: ReturnType<typeof createWorkspaceStore>;
  api: Window['api']['workspace'];
  home: Workspace;
  project: Workspace;
} {
  const home = workspace('home', '/home');
  const api: Window['api']['workspace'] = {
    list: vi.fn(async () => ({ workspaces: [home], activeWorkspaceId: 'home' })),
    get: vi.fn(async () => null),
    create: vi.fn(async () => project),
    update: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    setActiveWorkspaceId: vi.fn(async () => {}),
  };
  let id = 0;
  const store = createWorkspaceStore({
    workspaceApi: api,
    createId: () => `new-${++id}`,
    now: () => 42,
  });
  store.setState({ workspaces: [home, project], activeWorkspaceId: 'home' });
  return { store, api, home, project };
}

describe('launchAgent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['home', 'project'] as const)(
    'appends to %s without changing active workspace, active tab, or shell syntax',
    async (kind) => {
      // Given: home and an open project with existing shells.
      const { store, api } = setup();
      const original = store.getState().workspaces.find((entry) => entry.id === kind)!;
      // When: a command is launched.
      const result = await store
        .getState()
        .launchAgent(kind === 'home' ? { kind } : { kind, rootPath: '/work/' }, preset);
      await vi.advanceTimersByTimeAsync(350);
      // Then: the tab is custom-named at the root cwd, stays in the background, and the one-shot
      // command is only in memory.
      const current = store.getState().workspaces.find((entry) => entry.id === kind)!;
      expect(current.tabs).toHaveLength(2);
      expect(current.tabs[0]).toEqual(original.tabs[0]);
      expect(current.tabs[1]).toMatchObject({
        id: result.tabId,
        name: 'Agent',
        isCustomName: true,
      });
      expect(current.activeTabId).toBe(original.activeTabId);
      expect(current.panes[1]).toMatchObject({
        id: result.paneId,
        cwd: original.rootPath,
        initialCommand: preset.command,
      });
      expect(store.getState().activeWorkspaceId).toBe('home');
      expect(api.setActiveWorkspaceId).not.toHaveBeenCalled();
      expect(api.update).toHaveBeenCalledWith(
        expect.objectContaining({
          panes: [original.panes[0], { id: result.paneId, cwd: original.rootPath }],
        }),
      );
    },
  );

  it('shares project creation with Open Project and preserves concurrent tabs', async () => {
    // Given: no saved project and a deferred create request.
    const { store, api, home, project } = setup();
    store.setState({ workspaces: [home] });
    let resolve!: (value: Workspace) => void;
    vi.mocked(api.create).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    // When: two launches and Open Project overlap on equivalent paths.
    const first = store.getState().launchAgent({ kind: 'project', rootPath: '/work' }, preset);
    const second = store.getState().launchAgent({ kind: 'project', rootPath: '/work/./' }, preset);
    const opening = store.getState().openProject('/work/');
    resolve(project);
    const [a, b] = await Promise.all([first, second, opening]);
    // Then: one project was created, with its original shell and both agent tabs.
    expect(api.create).toHaveBeenCalledOnce();
    expect(a.paneId).not.toBe(b.paneId);
    expect(store.getState().workspaces.find((entry) => entry.id === project.id)?.tabs).toHaveLength(
      3,
    );
    expect(store.getState().activeWorkspaceId).toBe(project.id);
  });

  it('reopens a closed project without activating it or replaying its previous commands', async () => {
    // Given: a closed durable project.
    const project = { ...workspace('project'), isOpen: false };
    const { store, api } = setup(project);
    // When: an agent is launched into the closed project.
    await store.getState().launchAgent({ kind: 'project', rootPath: '/work' }, preset);
    // Then: reopen is persisted and the original shell remains separate from the new command.
    expect(api.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project', isOpen: true }),
    );
    expect(store.getState().activeWorkspaceId).toBe('home');
    expect(store.getState().workspaces[1].panes[0].initialCommand).toBeUndefined();
    expect(store.getState().workspaces[1].isOpen).toBe(true);
  });

  it('retains durable creation but adds no tab if canceled during IPC', async () => {
    // Given: an in-flight create and a cancelable launch.
    const { store, api, home, project } = setup();
    store.setState({ workspaces: [home] });
    let resolve!: (value: Workspace) => void;
    vi.mocked(api.create).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const launching = store
      .getState()
      .launchAgent({ kind: 'project', rootPath: '/work' }, preset, controller.signal);
    // When: the user dismisses before creation finishes.
    controller.abort();
    resolve(project);
    // Then: the created project remains with its initial shell, without an agent command.
    await expect(launching).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.getState().workspaces[1].tabs).toHaveLength(1);
    expect(store.getState().activeWorkspaceId).toBe('home');
    expect(api.setActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it.each(['close', 'delete'] as const)(
    'does not append after a project is removed by %s',
    async (action) => {
      // Given: an existing project; awaiting its resolution yields before tab creation.
      const { store, project } = setup();
      const deletion =
        action === 'delete' ? store.getState().deleteWorkspace(project.id) : undefined;
      const launching = store
        .getState()
        .launchAgent({ kind: 'project', rootPath: '/work' }, preset);
      // When: its structural state changes before the continuation.
      if (action === 'close') store.getState().closeWorkspace(project.id);
      else await deletion;
      // Then: the old snapshot cannot resurrect the project or append a hidden command.
      await expect(launching).rejects.toThrow('closed or deleted');
      expect(
        store
          .getState()
          .workspaces.find((entry) => entry.id === project.id)
          ?.panes.some((pane) => pane.initialCommand),
      ).not.toBe(true);
    },
  );

  it.each(['tabs', 'panes'] as const)('refuses a launch at the %s limit', async (field) => {
    // Given: a workspace at one of the IPC collection limits.
    const { store, project } = setup();
    if (field === 'tabs')
      project.tabs = Array.from({ length: MAX_WORKSPACE_TABS }, (_, index) => ({
        ...project.tabs[0],
        id: `tab-${index}`,
      }));
    else
      project.panes = Array.from({ length: MAX_WORKSPACE_PANES }, (_, index) => ({
        id: `pane-${index}`,
        cwd: '/work',
      }));
    // When: another agent tab is requested.
    const launching = store.getState().launchAgent({ kind: 'project', rootPath: '/work' }, preset);
    // Then: nothing is appended.
    await expect(launching).rejects.toThrow('limit reached');
    expect(store.getState().workspaces[1]).toBe(project);
  });

  it('derives bounded nonempty tab names while preserving the full command', async () => {
    // Given: a valid preset with a whitespace-only label and a long shell command.
    const { store } = setup();
    const command = 'codex ' + 'x'.repeat(500);
    // When: it is launched.
    await store.getState().launchAgent({ kind: 'home' }, { ...preset, label: '  ', command });
    // Then: only the display name is shortened to the IPC name limit.
    expect(store.getState().workspaces[0].tabs[1].name).toBe(
      command.slice(0, MAX_WORKSPACE_NAME_LENGTH),
    );
    expect(store.getState().workspaces[0].panes[1].initialCommand).toBe(command);
  });

  it('rejects an already canceled request before creating a project', async () => {
    // Given: a dismissed launch session.
    const { store, api } = setup();
    const controller = new AbortController();
    controller.abort();
    // When: launch is called with its signal.
    await expect(
      store
        .getState()
        .launchAgent({ kind: 'project', rootPath: '/new' }, preset, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // Then: no durable request was made.
    expect(api.create).not.toHaveBeenCalled();
  });
});
