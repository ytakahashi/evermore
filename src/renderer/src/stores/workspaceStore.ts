import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Pane, PaneLayout, Tab, Workspace } from '../../../shared/types';

const DEFAULT_SAVE_DEBOUNCE_MS = 300;

type WorkspaceApi = Window['api']['workspace'];

interface CreateWorkspaceStoreOptions {
  createId?: () => string;
  debounceMs?: number;
  now?: () => number;
  workspaceApi?: WorkspaceApi;
}

export interface WorkspaceStoreState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  error: string | null;
  loadWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  addTab: () => void;
  selectTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  updateWorkspace: (workspace: Workspace) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Workspace operation failed.';
}

/**
 * Returns the first leaf pane id in a layout tree.
 */
export function findFirstPaneId(layout: PaneLayout): string | null {
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

function createId(): string {
  return globalThis.crypto.randomUUID();
}

function collectPaneIds(layout: PaneLayout): string[] {
  if (layout.type === 'leaf') {
    return [layout.paneId];
  }

  return [...collectPaneIds(layout.children[0]), ...collectPaneIds(layout.children[1])];
}

function findActiveTabIndex(workspace: Workspace, tabId: string): number {
  const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
  return index >= 0 ? index : 0;
}

function selectNextTabIdAfterClose(workspace: Workspace, closingTabId: string): string | null {
  const closingIndex = findActiveTabIndex(workspace, closingTabId);
  const remainingTabs = workspace.tabs.filter((tab) => tab.id !== closingTabId);

  return remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]?.id ?? null;
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
  const createStoreId = options.createId ?? createId;
  const debounceMs = options.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
  const now = options.now ?? Date.now;
  let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const getWorkspaceApi = (): WorkspaceApi => options.workspaceApi ?? window.api.workspace;

  return create<WorkspaceStoreState>((set, get) => {
    const persistWorkspaceDebounced = (workspace: Workspace): void => {
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
    };

    return {
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
      addTab: (): void => {
        const state = get();
        const workspace = selectActiveWorkspace(state);
        const activePane = selectActivePane(state);
        if (!workspace) {
          return;
        }

        const tabId = createStoreId();
        const paneId = createStoreId();
        const cwd = activePane?.cwd ?? workspace.rootPath;
        const title = 'zsh';
        const updatedWorkspace: Workspace = {
          ...workspace,
          tabs: [
            ...workspace.tabs,
            {
              id: tabId,
              title,
              layout: {
                type: 'leaf',
                paneId,
              },
              activePaneId: paneId,
            },
          ],
          panes: [
            ...workspace.panes,
            {
              id: paneId,
              cwd,
              title,
            },
          ],
          activeTabId: tabId,
        };

        get().updateWorkspace(updatedWorkspace);
      },
      selectTab: (tabId: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace || workspace.activeTabId === tabId) {
          return;
        }

        const selectedTab = workspace.tabs.find((tab) => tab.id === tabId);
        if (!selectedTab) {
          return;
        }

        get().updateWorkspace({
          ...workspace,
          activeTabId: selectedTab.id,
        });
      },
      closeTab: (tabId: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace || workspace.tabs.length <= 1) {
          return;
        }

        const closingTab = workspace.tabs.find((tab) => tab.id === tabId);
        if (!closingTab) {
          return;
        }

        const removedPaneIds = new Set(collectPaneIds(closingTab.layout));
        const activeTabId =
          workspace.activeTabId === tabId
            ? selectNextTabIdAfterClose(workspace, tabId)
            : workspace.activeTabId;
        const updatedWorkspace: Workspace = {
          ...workspace,
          tabs: workspace.tabs.filter((tab) => tab.id !== tabId),
          panes: workspace.panes.filter((pane) => !removedPaneIds.has(pane.id)),
          activeTabId,
        };

        get().updateWorkspace(updatedWorkspace);
      },
      updateWorkspace: (workspace: Workspace): void => {
        const updatedWorkspace = {
          ...workspace,
          updatedAt: now(),
        };

        set((state) => ({
          workspaces: replaceWorkspace(state.workspaces, updatedWorkspace),
          activeWorkspaceId: state.activeWorkspaceId ?? updatedWorkspace.id,
        }));
        persistWorkspaceDebounced(updatedWorkspace);
      },
    };
  });
}

export const useWorkspaceStore = createWorkspaceStore();
