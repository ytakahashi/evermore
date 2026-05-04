import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Pane, PaneLayout, Tab, Workspace } from '../../../shared/types';

const DEFAULT_SAVE_DEBOUNCE_MS = 300;
const DEFAULT_CWD_SAVE_DEBOUNCE_MS = 1000;
const DEFAULT_SPLIT_RATIO = 0.5;
const MAX_SPLIT_RATIO = 0.85;
const MIN_SPLIT_RATIO = 0.15;

type WorkspaceApi = Window['api']['workspace'];
type SplitDirection = Extract<PaneLayout, { type: 'split' }>['direction'];

interface CreateWorkspaceStoreOptions {
  createId?: () => string;
  cwdDebounceMs?: number;
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
  setActivePane: (paneId: string) => void;
  splitPane: (paneId: string, direction: SplitDirection) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (path: number[], ratio: number) => void;
  updatePaneCwd: (paneId: string, cwd: string) => void;
  updateWorkspace: (workspace: Workspace) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function clampSplitRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

function replaceTab(workspace: Workspace, tab: Tab): Workspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map((currentTab) => (currentTab.id === tab.id ? tab : currentTab)),
  };
}

function replacePaneLayout(
  layout: PaneLayout,
  paneId: string,
  replacement: PaneLayout,
): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? replacement : layout;
  }

  return {
    ...layout,
    children: [
      replacePaneLayout(layout.children[0], paneId, replacement),
      replacePaneLayout(layout.children[1], paneId, replacement),
    ],
  };
}

function removePaneLayout(
  layout: PaneLayout,
  paneId: string,
): { layout: PaneLayout | null; removed: boolean } {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? { layout: null, removed: true } : { layout, removed: false };
  }

  const firstChild = removePaneLayout(layout.children[0], paneId);
  if (firstChild.removed) {
    // Collapse this split only when the direct child was removed. If deletion happened deeper in
    // that child subtree, keep this split node and replace just the changed child so sibling panes
    // outside the removed subtree stay visible.
    return {
      layout:
        firstChild.layout === null
          ? layout.children[1]
          : {
              ...layout,
              children: [firstChild.layout, layout.children[1]],
            },
      removed: true,
    };
  }

  const secondChild = removePaneLayout(layout.children[1], paneId);
  if (secondChild.removed) {
    // Same rule as above for the second child: direct child removal promotes the sibling, while a
    // nested removal preserves the current split and swaps in the updated child subtree.
    return {
      layout:
        secondChild.layout === null
          ? layout.children[0]
          : {
              ...layout,
              children: [layout.children[0], secondChild.layout],
            },
      removed: true,
    };
  }

  return { layout, removed: false };
}

function updateSplitRatio(layout: PaneLayout, path: number[], ratio: number): PaneLayout {
  if (layout.type === 'leaf') {
    return layout;
  }

  if (path.length === 0) {
    return {
      ...layout,
      ratio: clampSplitRatio(ratio),
    };
  }

  const [childIndex, ...remainingPath] = path;
  if (childIndex !== 0 && childIndex !== 1) {
    return layout;
  }

  return {
    ...layout,
    children: layout.children.map((child, index) =>
      index === childIndex ? updateSplitRatio(child, remainingPath, ratio) : child,
    ) as [PaneLayout, PaneLayout],
  };
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
  const cwdDebounceMs = options.cwdDebounceMs ?? DEFAULT_CWD_SAVE_DEBOUNCE_MS;
  const debounceMs = options.debounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS;
  const now = options.now ?? Date.now;
  let persistTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const dirtyWorkspaceIds = new Set<string>();

  const getWorkspaceApi = (): WorkspaceApi => options.workspaceApi ?? window.api.workspace;

  return create<WorkspaceStoreState>((set, get) => {
    const persistWorkspaceDebounced = (workspaceId: string, delayMs = debounceMs): void => {
      // `updatePaneCwd` and `updateWorkspace` share this timer intentionally: any workspace mutation
      // such as tab close or split is a natural flush point that carries the latest cwd snapshot.
      dirtyWorkspaceIds.add(workspaceId);

      if (persistTimer) {
        globalThis.clearTimeout(persistTimer);
      }

      persistTimer = globalThis.setTimeout(() => {
        persistTimer = null;
        const workspaceIdsToPersist = new Set(dirtyWorkspaceIds);
        dirtyWorkspaceIds.clear();
        const currentWorkspaces = get().workspaces;
        Promise.all(
          currentWorkspaces
            .filter((workspace) => workspaceIdsToPersist.has(workspace.id))
            .map((workspace) => getWorkspaceApi().update(workspace)),
        ).catch((error: unknown) => {
          set({ error: getErrorMessage(error) });
        });
      }, delayMs);
    };

    const updateWorkspaceState = (workspace: Workspace): Workspace => {
      const updatedWorkspace = {
        ...workspace,
        updatedAt: now(),
      };

      set((state) => ({
        workspaces: replaceWorkspace(state.workspaces, updatedWorkspace),
        activeWorkspaceId: state.activeWorkspaceId ?? updatedWorkspace.id,
      }));

      return updatedWorkspace;
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
        const title = activePane?.title ?? workspace.panes[0]?.title ?? 'zsh';
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
      setActivePane: (paneId: string): void => {
        const workspace = selectActiveWorkspace(get());
        const tab = selectActiveTab(get());
        if (!workspace || !tab || tab.activePaneId === paneId) {
          return;
        }

        if (!collectPaneIds(tab.layout).includes(paneId)) {
          return;
        }

        get().updateWorkspace(
          replaceTab(workspace, {
            ...tab,
            activePaneId: paneId,
          }),
        );
      },
      splitPane: (paneId: string, direction: SplitDirection): void => {
        const workspace = selectActiveWorkspace(get());
        const tab = selectActiveTab(get());
        if (!workspace || !tab || !collectPaneIds(tab.layout).includes(paneId)) {
          return;
        }

        const sourcePane = workspace.panes.find((pane) => pane.id === paneId);
        if (!sourcePane) {
          return;
        }

        const newPaneId = createStoreId();
        const newPane: Pane = {
          id: newPaneId,
          cwd: sourcePane.cwd,
          title: sourcePane.title,
        };
        const updatedTab: Tab = {
          ...tab,
          layout: replacePaneLayout(tab.layout, paneId, {
            type: 'split',
            direction,
            ratio: DEFAULT_SPLIT_RATIO,
            children: [
              {
                type: 'leaf',
                paneId,
              },
              {
                type: 'leaf',
                paneId: newPaneId,
              },
            ],
          }),
          activePaneId: newPaneId,
        };

        get().updateWorkspace({
          ...replaceTab(workspace, updatedTab),
          panes: [...workspace.panes, newPane],
        });
      },
      closePane: (paneId: string): void => {
        const workspace = selectActiveWorkspace(get());
        const tab = selectActiveTab(get());
        if (!workspace || !tab) {
          return;
        }

        const removedLayout = removePaneLayout(tab.layout, paneId);
        if (!removedLayout.removed || !removedLayout.layout) {
          return;
        }

        const remainingPaneIds = new Set(collectPaneIds(removedLayout.layout));
        const activePaneId =
          tab.activePaneId && remainingPaneIds.has(tab.activePaneId)
            ? tab.activePaneId
            : findFirstPaneId(removedLayout.layout);
        const updatedTab: Tab = {
          ...tab,
          layout: removedLayout.layout,
          activePaneId,
        };

        get().updateWorkspace({
          ...replaceTab(workspace, updatedTab),
          panes: workspace.panes.filter((pane) => pane.id !== paneId),
        });
      },
      resizeSplit: (path: number[], ratio: number): void => {
        const workspace = selectActiveWorkspace(get());
        const tab = selectActiveTab(get());
        if (!workspace || !tab) {
          return;
        }

        get().updateWorkspace(
          replaceTab(workspace, {
            ...tab,
            layout: updateSplitRatio(tab.layout, path, ratio),
          }),
        );
      },
      updatePaneCwd: (paneId: string, cwd: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace) {
          return;
        }

        const pane = workspace.panes.find((currentPane) => currentPane.id === paneId);
        if (!pane || pane.cwd === cwd) {
          return;
        }

        const updatedWorkspace = updateWorkspaceState({
          ...workspace,
          panes: workspace.panes.map((currentPane) =>
            currentPane.id === paneId ? { ...currentPane, cwd } : currentPane,
          ),
        });
        persistWorkspaceDebounced(updatedWorkspace.id, cwdDebounceMs);
      },
      updateWorkspace: (workspace: Workspace): void => {
        const updatedWorkspace = updateWorkspaceState(workspace);
        persistWorkspaceDebounced(updatedWorkspace.id);
      },
    };
  });
}

export const useWorkspaceStore = createWorkspaceStore();
