import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Pane, PaneLayout, Tab, Workspace } from '../../../shared/types';

const DEFAULT_SAVE_DEBOUNCE_MS = 300;

type WorkspaceApi = Window['api']['workspace'];

interface CreateWorkspaceStoreOptions {
  debounceMs?: number;
  workspaceApi?: WorkspaceApi;
}

export interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  error: string | null;
  loadWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  updateWorkspace: (workspace: Workspace) => void;
  persistWorkspaceDebounced: (workspace: Workspace) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Workspace operation failed.';
}

function findFirstPaneId(layout: PaneLayout): string | null {
  if (layout.type === 'leaf') {
    return layout.paneId;
  }

  return findFirstPaneId(layout.children[0]) ?? findFirstPaneId(layout.children[1]);
}

function replaceWorkspace(workspaces: Workspace[], workspace: Workspace): Workspace[] {
  if (workspaces.some((currentWorkspace) => currentWorkspace.id === workspace.id)) {
    return workspaces.map((currentWorkspace) =>
      currentWorkspace.id === workspace.id ? workspace : currentWorkspace,
    );
  }

  return [...workspaces, workspace];
}

/**
 * Returns the workspace selected in renderer state, falling back to the first loaded workspace.
 */
export function selectActiveWorkspace(state: WorkspaceStoreState): Workspace | null {
  return (
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ??
    state.workspaces[0] ??
    null
  );
}

/**
 * Returns the active tab for the selected workspace.
 */
export function selectActiveTab(state: WorkspaceStoreState): Tab | null {
  const workspace = selectActiveWorkspace(state);
  if (!workspace) {
    return null;
  }

  return (
    workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? workspace.tabs[0] ?? null
  );
}

/**
 * Returns the active pane for the selected workspace and tab.
 */
export function selectActivePane(state: WorkspaceStoreState): Pane | null {
  const workspace = selectActiveWorkspace(state);
  const tab = selectActiveTab(state);
  if (!workspace || !tab) {
    return null;
  }

  const paneId = tab.activePaneId ?? findFirstPaneId(tab.layout);
  if (!paneId) {
    return null;
  }

  return workspace.panes.find((pane) => pane.id === paneId) ?? null;
}

/**
 * Creates the renderer workspace store with injectable API and debounce controls for tests.
 */
export function createWorkspaceStore(
  options: CreateWorkspaceStoreOptions = {},
): UseBoundStore<StoreApi<WorkspaceStoreState>> {
  const debounceMs = options.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
  let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const getWorkspaceApi = (): WorkspaceApi => options.workspaceApi ?? window.api.workspace;

  return create<WorkspaceStoreState>((set, get) => ({
    workspaces: [],
    activeWorkspaceId: null,
    isLoading: false,
    error: null,
    loadWorkspaces: async (): Promise<void> => {
      set({ isLoading: true, error: null });

      try {
        const workspaces = await getWorkspaceApi().list();
        const currentActiveWorkspaceId = get().activeWorkspaceId;
        const activeWorkspaceId =
          workspaces.find((workspace) => workspace.id === currentActiveWorkspaceId)?.id ??
          workspaces[0]?.id ??
          null;

        set({ workspaces, activeWorkspaceId, isLoading: false });
      } catch (error: unknown) {
        set({ error: getErrorMessage(error), isLoading: false });
      }
    },
    setActiveWorkspace: (id: string): void => {
      set({ activeWorkspaceId: id });
    },
    updateWorkspace: (workspace: Workspace): void => {
      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, workspace),
        activeWorkspaceId: state.activeWorkspaceId ?? workspace.id,
      }));
      get().persistWorkspaceDebounced(workspace);
    },
    persistWorkspaceDebounced: (workspace: Workspace): void => {
      if (persistTimer) {
        globalThis.clearTimeout(persistTimer);
      }

      persistTimer = globalThis.setTimeout(() => {
        persistTimer = null;
        void getWorkspaceApi()
          .update(workspace)
          .catch((error: unknown) => {
            set({ error: getErrorMessage(error) });
          });
      }, debounceMs);
    },
  }));
}

export const useWorkspaceStore = createWorkspaceStore();
