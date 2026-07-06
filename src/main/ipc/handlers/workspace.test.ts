import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { Workspace } from '../../../shared/types';
import type { WorkspaceStore } from '../../workspace/workspace-store';
import { MAX_ID_LENGTH, MAX_NAME_LENGTH, MAX_PATH_LENGTH } from '../validation';
import {
  expectIpcRequestNotAllowed,
  expectInvalidPayload,
  ipcMainMock,
  requireHandler,
  resetIpcMainMock,
} from './test-utils/ipc-main-mock';
import { registerWorkspaceHandlers } from './workspace';

interface TestWorkspaceStore {
  list: ReturnType<typeof vi.fn<() => Workspace[]>>;
  getActiveWorkspaceId: ReturnType<typeof vi.fn<() => string | null>>;
  get: ReturnType<typeof vi.fn<(id: string) => Workspace | null>>;
  create: ReturnType<typeof vi.fn<(name: string, rootPath: string) => Workspace>>;
  update: ReturnType<typeof vi.fn<(workspace: Workspace) => void>>;
  delete: ReturnType<typeof vi.fn<(id: string) => void>>;
  setActiveWorkspaceId: ReturnType<typeof vi.fn<(id: string | null) => void>>;
}

const workspace: Workspace = {
  id: 'workspace-1',
  name: 'Project',
  rootPath: '/Users/tester/project',
  tabs: [
    {
      id: 'tab-1',
      name: 'zsh',
      isCustomName: false,
      layout: { type: 'leaf', paneId: 'pane-1' },
      activePaneId: 'pane-1',
    },
  ],
  panes: [{ id: 'pane-1', cwd: '/Users/tester/project' }],
  activeTabId: 'tab-1',
  createdAt: 1_000,
  updatedAt: 1_000,
};

function createWorkspaceStore(): TestWorkspaceStore {
  return {
    list: vi.fn(() => [workspace]),
    getActiveWorkspaceId: vi.fn(() => workspace.id),
    get: vi.fn(() => workspace),
    create: vi.fn(() => workspace),
    update: vi.fn(),
    delete: vi.fn(),
    setActiveWorkspaceId: vi.fn(),
  };
}

function registerWithWorkspaceStore(): TestWorkspaceStore {
  const workspaceStore = createWorkspaceStore();
  registerWorkspaceHandlers({
    workspaceStore: workspaceStore as unknown as WorkspaceStore,
  });
  return workspaceStore;
}

const invalidIdPayloads: Array<[string, unknown]> = [
  ['null', null],
  ['array', []],
  ['missing id', {}],
  ['undefined id', { id: undefined }],
  ['wrong-type id', { id: 1 }],
  ['empty id', { id: '' }],
  ['over-limit id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
];

describe('registerWorkspaceHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('lists workspaces with the active workspace id', () => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When: the renderer requests the workspace list.
    const result = requireHandler(IPC.WS_LIST)({});

    // Then: the handler combines the store snapshots.
    expect(result).toEqual({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
    });
    expect(workspaceStore.list).toHaveBeenCalledOnce();
    expect(workspaceStore.getActiveWorkspaceId).toHaveBeenCalledOnce();
  });

  it('delegates valid primitive workspace requests and ignores extra keys', () => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When: the renderer invokes primitive workspace handlers with extra keys.
    const fetched = requireHandler(IPC.WS_GET)({}, { id: workspace.id, extra: true });
    const created = requireHandler(IPC.WS_CREATE)(
      {},
      { name: 'New workspace', rootPath: '/Users/tester/new', extra: true },
    );
    requireHandler(IPC.WS_DELETE)({}, { id: workspace.id, extra: true });
    requireHandler(IPC.WS_SET_ACTIVE_ID)({}, { id: 'stale-workspace-id', extra: true });

    // Then: only validated known fields reach the store.
    expect(fetched).toBe(workspace);
    expect(created).toBe(workspace);
    expect(workspaceStore.get).toHaveBeenCalledWith(workspace.id);
    expect(workspaceStore.create).toHaveBeenCalledWith('New workspace', '/Users/tester/new');
    expect(workspaceStore.delete).toHaveBeenCalledWith(workspace.id);
    expect(workspaceStore.setActiveWorkspaceId).toHaveBeenCalledWith('stale-workspace-id');
  });

  it('allows an empty create root path for the store home-directory fallback', () => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When: the renderer creates a workspace without a root path.
    requireHandler(IPC.WS_CREATE)({}, { name: 'Home workspace', rootPath: '' });

    // Then: the empty root path reaches the store unchanged.
    expect(workspaceStore.create).toHaveBeenCalledWith('Home workspace', '');
  });

  it('allows null as the active workspace id', () => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When: the renderer clears the active workspace id.
    requireHandler(IPC.WS_SET_ACTIVE_ID)({}, { id: null });

    // Then: null reaches the store unchanged.
    expect(workspaceStore.setActiveWorkspaceId).toHaveBeenCalledWith(null);
  });

  it('validates and reconstructs workspace updates before delegation', () => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();
    const rendererWorkspace = {
      ...workspace,
      unknownWorkspace: true,
      tabs: [{ ...workspace.tabs[0], unknownTab: true }],
      panes: [{ ...workspace.panes[0], ptyId: 'pty-1', unknownPane: true }],
    };

    // When: the renderer sends a workspace update.
    requireHandler(IPC.WS_UPDATE)({}, { workspace: rendererWorkspace, extra: true });

    // Then: only reconstructed known workspace fields are delegated.
    expect(workspaceStore.get).toHaveBeenCalledWith(workspace.id);
    expect(workspaceStore.update).toHaveBeenCalledWith({
      ...workspace,
      tabs: [workspace.tabs[0]],
      panes: [{ ...workspace.panes[0], ptyId: 'pty-1' }],
    });
    expect(workspaceStore.update.mock.calls[0]?.[0]).not.toBe(rendererWorkspace);
  });

  it('rejects structurally valid updates for missing workspace targets', () => {
    // Given: the workspace target does not exist in the store.
    const workspaceStore = registerWithWorkspaceStore();
    workspaceStore.get.mockReturnValue(null);

    // When / Then: the update capability cannot create a new workspace.
    expectIpcRequestNotAllowed(IPC.WS_UPDATE, () =>
      requireHandler(IPC.WS_UPDATE)({}, { workspace }),
    );
    expect(workspaceStore.get).toHaveBeenCalledWith(workspace.id);
    expect(workspaceStore.update).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object outer payload', null],
    ['missing workspace', {}],
    ['invalid workspace', { workspace: { ...workspace, panes: [] } }],
  ])('rejects invalid workspace:update payloads: %s', (_label: string, payload: unknown) => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When / Then: malformed updates are rejected before any store lookup or mutation.
    expectInvalidPayload(IPC.WS_UPDATE, () => requireHandler(IPC.WS_UPDATE)({}, payload));
    expect(workspaceStore.get).not.toHaveBeenCalled();
    expect(workspaceStore.update).not.toHaveBeenCalled();
  });

  it.each(invalidIdPayloads)(
    'rejects invalid workspace:get payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: workspace handlers are registered with an injected store.
      const workspaceStore = registerWithWorkspaceStore();

      // When / Then: malformed payloads are rejected before store access.
      expectInvalidPayload(IPC.WS_GET, () => requireHandler(IPC.WS_GET)({}, payload));
      expect(workspaceStore.get).not.toHaveBeenCalled();
    },
  );

  it.each(invalidIdPayloads)(
    'rejects invalid workspace:delete payloads: %s',
    (_label: string, payload: unknown) => {
      // Given: workspace handlers are registered with an injected store.
      const workspaceStore = registerWithWorkspaceStore();

      // When / Then: malformed payloads are rejected before store mutation.
      expectInvalidPayload(IPC.WS_DELETE, () => requireHandler(IPC.WS_DELETE)({}, payload));
      expect(workspaceStore.delete).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['null', null],
    ['array', []],
    ['missing name', { rootPath: '/Users/tester/project' }],
    ['undefined name', { name: undefined, rootPath: '/Users/tester/project' }],
    ['wrong-type name', { name: 1, rootPath: '/Users/tester/project' }],
    ['empty name', { name: '', rootPath: '/Users/tester/project' }],
    [
      'over-limit name',
      { name: 'x'.repeat(MAX_NAME_LENGTH + 1), rootPath: '/Users/tester/project' },
    ],
    ['missing rootPath', { name: 'Project' }],
    ['undefined rootPath', { name: 'Project', rootPath: undefined }],
    ['wrong-type rootPath', { name: 'Project', rootPath: 1 }],
    ['over-limit rootPath', { name: 'Project', rootPath: 'x'.repeat(MAX_PATH_LENGTH + 1) }],
  ])('rejects invalid workspace:create payloads: %s', (_label: string, payload: unknown) => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When / Then: malformed payloads are rejected before store mutation.
    expectInvalidPayload(IPC.WS_CREATE, () => requireHandler(IPC.WS_CREATE)({}, payload));
    expect(workspaceStore.create).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['array', []],
    ['missing id', {}],
    ['undefined id', { id: undefined }],
    ['wrong-type id', { id: 1 }],
    ['empty id', { id: '' }],
    ['over-limit id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
  ])('rejects invalid active workspace id payloads: %s', (_label: string, payload: unknown) => {
    // Given: workspace handlers are registered with an injected store.
    const workspaceStore = registerWithWorkspaceStore();

    // When / Then: malformed payloads are rejected before store mutation.
    expectInvalidPayload(IPC.WS_SET_ACTIVE_ID, () =>
      requireHandler(IPC.WS_SET_ACTIVE_ID)({}, payload),
    );
    expect(workspaceStore.setActiveWorkspaceId).not.toHaveBeenCalled();
  });

  it('removes every workspace handler during teardown', () => {
    // Given: workspace handlers have been registered.
    const workspaceStore = createWorkspaceStore();
    const dispose = registerWorkspaceHandlers({
      workspaceStore: workspaceStore as unknown as WorkspaceStore,
    });

    // When: registration is disposed.
    dispose();

    // Then: every workspace IPC handler is removed.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_LIST);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_GET);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_CREATE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_UPDATE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_DELETE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.WS_SET_ACTIVE_ID);
  });
});
