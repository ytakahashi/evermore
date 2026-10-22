import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { normalizeAbsolutePath } from '../../../shared/absolute-path';
import {
  collectPaneIds,
  findFirstPaneId,
  replacePaneLayout,
  removePaneLayout,
  updateSplitRatio,
} from '../../../shared/pane-layout';
import { findAdjacentPaneId, type PaneFocusDirection } from '../../../shared/pane-navigation';
import { getPathBasename } from '../../../shared/path-label';
import type { Pane, PaneLayout, Tab, Workspace } from '../../../shared/types';
import { MAX_WORKSPACE_TABS } from '../../../shared/workspace-constants';
import { canDeleteWorkspace, findFallbackWorkspace } from '../../../shared/workspace-kind';
import {
  getAutomaticTabName,
  syncTabNameWithPane,
  setTabActivePane,
} from '../workspace/tab-naming';
import {
  extractPaneToTab,
  preparePaneExtraction,
  removeTab,
  reorderTab,
} from '../workspace/tab-operations';
import { prepareTabTransfer, transferTab } from '../workspace/tab-transfer';
import { findProjectWorkspace } from '../projects/projectCandidates';
import { findOpenWorkspace, getOpenWorkspaces } from '../workspace/open-workspaces';

const DEFAULT_SAVE_DEBOUNCE_MS = 300;
const DEFAULT_CWD_SAVE_DEBOUNCE_MS = 1000;
const DEFAULT_SPLIT_RATIO = 0.5;

type WorkspaceApi = Window['api']['workspace'];
type SplitDirection = Extract<PaneLayout, { type: 'split' }>['direction'];
export type TabSelectionDirection = 'next' | 'previous';

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
  /** Opens or creates a project, retaining successful durable writes if active-ID persistence fails. */
  openProject: (rootPath: string, signal?: AbortSignal) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => void;
  addTab: () => void;
  addWorkspaceTab: (workspaceId: string) => void;
  renameTab: (tabId: string, name: string) => void;
  renameWorkspaceTab: (workspaceId: string, tabId: string, name: string) => void;
  openSshHostTab: (alias: string) => void;
  selectWorkspacePane: (workspaceId: string, tabId: string, paneId: string) => void;
  selectWorkspaceTab: (workspaceId: string, tabId: string) => void;
  selectTab: (tabId: string) => void;
  closeWorkspaceTab: (workspaceId: string, tabId: string) => void;
  /**
   * Reorders a tab within its workspace by moving it to `toIndex` (clamped to the valid range).
   * No-op when the workspace or tab is missing or the tab is already at the target index. The
   * primitive is index based rather than direction based so it backs both the menu (which computes
   * the previous / next index) and any future drag-and-drop reordering without a second action.
   */
  reorderWorkspaceTab: (workspaceId: string, tabId: string, toIndex: number) => void;
  /**
   * Moves a tab and the panes it owns from `sourceWorkspaceId` to `targetWorkspaceId`, inserting it
   * at `toIndex` in the target's tab list and making it the target's active tab. When `toIndex` is
   * omitted the tab is appended (menu-driven moves rely on this default); when given it is clamped
   * to `[0, targetTabs.length]` so drag-and-drop can drop the tab at any position. No-op when either
   * workspace or the tab is missing, when either workspace is closed, when source equals target, or
   * when the tab is the only one left
   * in the source workspace (the "at least one tab" invariant mirrors {@link closeWorkspaceTab}).
   * The source's active tab advances by the same rule as a tab close, and both workspaces are
   * persisted in a single update.
   *
   * The moved panes keep their runtime `ptyId` on purpose. `MainTerminalArea` mounts every tab in a
   * single list keyed by `tab.id`, so a moved tab keeps its React identity and its terminals are not
   * unmounted — the live PTY survives the move. Carrying `ptyId` here keeps the moved pane in sync
   * with that still-running terminal; dropping it would desync the pane from its live PTY.
   */
  moveTabToWorkspace: (
    sourceWorkspaceId: string,
    tabId: string,
    targetWorkspaceId: string,
    toIndex?: number,
  ) => void;
  /**
   * Splits `paneId` out of `sourceTabId` into a brand-new tab appended to `workspaceId`'s tab list,
   * making the new tab and the moved pane active. No-op unless the workspace and source tab exist,
   * the pane is referenced exactly once by the source tab's layout, the source tab has at least two
   * panes (so it is never left empty), and the workspace has not reached {@link MAX_WORKSPACE_TABS}.
   * `Workspace.panes` is untouched — only the source and destination tabs' layout references change
   * — so the moved pane's `pane.id` stays stable and `MainTerminalArea`'s flat pane rendering keeps
   * its PTY/xterm session alive across the tab change. Switches the active workspace to
   * `workspaceId` when it differs, mirroring {@link addWorkspaceTab}, so the destination tab is
   * immediately visible and the existing active-selection effect clears fullscreen / moves focus.
   */
  createTabFromPane: (workspaceId: string, sourceTabId: string, paneId: string) => void;
  setActivePane: (paneId: string) => void;
  setPanePtyId: (paneId: string, ptyId: string | null) => void;
  splitPane: (paneId: string, direction: SplitDirection) => void;
  /**
   * Splits the active pane of the active workspace's active tab. No-op when there is no active
   * workspace, tab, or pane. Used by the menu-driven shortcut dispatcher so the menu click handler
   * does not need to resolve the active pane id itself.
   */
  splitActivePane: (direction: SplitDirection) => void;
  /**
   * Selects the next / previous tab on the active workspace, wrapping around at the ends. No-op
   * when the workspace has zero or one tab. Used by the menu-driven shortcut dispatcher.
   */
  selectAdjacentTab: (direction: TabSelectionDirection) => void;
  /**
   * Selects the next / previous tab across all workspaces, treating every workspace's tabs as a
   * single ordered list. Stepping off the end of one workspace lands on the first tab of the next
   * workspace (wrapping around at the boundaries). Workspaces with zero tabs are skipped. No-op
   * when the total tab count across workspaces is at most one. Used by the menu-driven shortcut
   * dispatcher.
   */
  selectAdjacentTabGlobal: (direction: TabSelectionDirection) => void;
  /**
   * Moves focus to the pane geometrically adjacent to the active pane in the given direction, as
   * resolved by {@link findAdjacentPaneId}. No-op when that helper finds no neighbor.
   */
  focusAdjacentPane: (direction: PaneFocusDirection) => void;
  closePane: (paneId: string) => void;
  /**
   * Closes a pane in response to its PTY exiting. Behaves like {@link closePane} when the tab has
   * more than one pane. When the exiting pane is the last one in its tab, the tab is closed via
   * {@link closeWorkspaceTab}, unless it is the only tab in the workspace — in that case the pane
   * is intentionally left in place so the workspace never becomes empty.
   */
  closePaneOnExit: (paneId: string) => void;
  resizeSplit: (path: number[], ratio: number) => void;
  updatePaneCwd: (paneId: string, cwd: string) => void;
  /**
   * Reflects an authoritative cwd observation keyed by runtime PTY id.
   *
   * Bridge code that receives `PaneRuntimeInfo` from the main process does not know which workspace
   * owns the PTY, so it cannot use {@link updatePaneCwd} directly. This helper scans all loaded
   * workspaces (every open workspace stays mounted, see `MainTerminalArea`; closed ones hold no PTY
   * ids) and forwards to the same cwd update path as {@link updatePaneCwd}.
   */
  updatePaneCwdByPtyId: (ptyId: string, cwd: string) => void;
  updateWorkspace: (workspace: Workspace) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

function stripRuntimePaneFieldsForWorkspaceUpdate(pane: Pane): Pane {
  const { ptyId: _ptyId, initialCommand: _initialCommand, ...persistedPane } = pane;
  return persistedPane;
}

function toWorkspaceUpdatePayload(workspace: Workspace): Workspace {
  // `workspace:update` is validated before main-process persistence gets a chance to sanitize it.
  // Keep renderer runtime fields in Zustand, but strip them from the IPC payload so the request
  // matches the durable workspace contract.
  return {
    ...workspace,
    panes: workspace.panes.map(stripRuntimePaneFieldsForWorkspaceUpdate),
  };
}

function replaceTab(workspace: Workspace, tab: Tab): Workspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map((currentTab) => (currentTab.id === tab.id ? tab : currentTab)),
  };
}

function getTabActivePaneId(tab: Tab): string | null {
  return tab.activePaneId ?? findFirstPaneId(tab.layout);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface CreateTabWithPaneOptions {
  cwd: string;
  initialCommand?: string;
  isCustomName?: boolean;
  tabName: string;
}

function createTabWithPane(
  createId: () => string,
  options: CreateTabWithPaneOptions,
): { pane: Pane; tab: Tab } {
  const tabId = createId();
  const paneId = createId();

  return {
    pane: {
      id: paneId,
      cwd: options.cwd,
      initialCommand: options.initialCommand,
    },
    tab: {
      id: tabId,
      name: options.tabName,
      isCustomName: options.isCustomName ?? false,
      layout: {
        type: 'leaf',
        paneId,
      },
      activePaneId: paneId,
    },
  };
}

/**
 * Returns the workspace selected in renderer state, falling back to the home workspace when the
 * selection is missing or closed.
 */
export function selectActiveWorkspace(state: WorkspaceStoreState): Workspace | null {
  return (
    findOpenWorkspace(state.workspaces, state.activeWorkspaceId) ??
    findFallbackWorkspace(state.workspaces)
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
  const openingProjects = new Map<string, Promise<Workspace>>();

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
            .map((workspace) => getWorkspaceApi().update(toWorkspaceUpdatePayload(workspace))),
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

    // Updates several existing workspaces in a single `set` so a cross-workspace mutation (moving a
    // tab) commits both sides atomically and React renders one consistent snapshot. Unlike
    // `updateWorkspaceState` this never appends: callers pass workspaces that already exist, and any
    // id not currently in the store is ignored. Persisting the touched ids is left to the caller so
    // both can share the existing debounced flush.
    const updateWorkspacesState = (updates: Workspace[], activeWorkspaceId?: string): void => {
      const timestamp = now();
      const stampedById = new Map(
        updates.map((workspace) => [workspace.id, { ...workspace, updatedAt: timestamp }]),
      );

      set((state) => ({
        activeWorkspaceId: activeWorkspaceId ?? state.activeWorkspaceId,
        workspaces: state.workspaces.map((workspace) => stampedById.get(workspace.id) ?? workspace),
      }));
    };

    // Shared cwd-update body for both pane-id and pty-id keyed actions. Keeping the early-return
    // and persistence call in one place is what guarantees that re-emits of the same cwd cannot
    // bump `workspace.updatedAt` regardless of which entry point the caller used.
    const applyCwdUpdate = (workspace: Workspace, paneId: string, cwd: string): void => {
      const pane = workspace.panes.find((currentPane) => currentPane.id === paneId);
      if (!pane || pane.cwd === cwd) {
        return;
      }

      const updatedPane = { ...pane, cwd };
      const updatedWorkspace = updateWorkspaceState({
        ...workspace,
        panes: workspace.panes.map((currentPane) =>
          currentPane.id === paneId ? updatedPane : currentPane,
        ),
        tabs: workspace.tabs.map((tab) =>
          getTabActivePaneId(tab) === paneId ? syncTabNameWithPane(tab, updatedPane) : tab,
        ),
      });
      persistWorkspaceDebounced(updatedWorkspace.id, cwdDebounceMs);
    };

    return {
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
      loadWorkspaces: async (): Promise<void> => {
        set({ isLoading: true, error: null });

        try {
          const { workspaces, activeWorkspaceId: persistedActiveId } =
            await getWorkspaceApi().list();
          // Validate that the persisted id still refers to a known, open workspace; main does not
          // check `isOpen` when it stores the active id.
          const activeWorkspaceId =
            findOpenWorkspace(workspaces, persistedActiveId)?.id ??
            findFallbackWorkspace(workspaces)?.id ??
            null;

          set({ workspaces, activeWorkspaceId, isLoading: false });
        } catch (error: unknown) {
          set({ error: getErrorMessage(error), isLoading: false });
        }
      },
      setActiveWorkspace: (id: string): void => {
        // Closed workspaces are activated only by `openProject`, which reopens them first.
        if (!findOpenWorkspace(get().workspaces, id)) return;
        set({ activeWorkspaceId: id });
        void getWorkspaceApi().setActiveWorkspaceId(id);
      },
      openProject: async (rootPath: string, signal?: AbortSignal): Promise<Workspace> => {
        if (!rootPath.startsWith('/')) throw new Error('Project path must be absolute');
        const key = normalizeAbsolutePath(rootPath);
        try {
          let opening = openingProjects.get(key);
          if (!opening) {
            opening = (async (): Promise<Workspace> => {
              const state = get();
              let workspace = findProjectWorkspace(state.workspaces, key, state.activeWorkspaceId);
              if (!workspace) {
                workspace = await getWorkspaceApi().create(getPathBasename(key), key);
                const created = workspace;
                set((current) => ({ workspaces: replaceWorkspace(current.workspaces, created) }));
              } else if (!workspace.isOpen) {
                await getWorkspaceApi().update(
                  toWorkspaceUpdatePayload({ ...workspace, isOpen: true }),
                );
                const reopeningId = workspace.id;
                const latest = get().workspaces.find((current) => current.id === reopeningId);
                if (!latest) throw new Error('Project was deleted while opening');
                // Preserve edits during IPC; queued persistence must see the reopened state.
                workspace = { ...latest, isOpen: true };
                updateWorkspaceState(workspace);
                persistWorkspaceDebounced(workspace.id);
              }
              return workspace;
            })();
            openingProjects.set(key, opening);
            void opening
              .finally(() => openingProjects.delete(key))
              .catch((_error: unknown) => {
                // Each caller handles failure; cleanup must not create an unhandled rejection.
              });
          }
          const workspace = await opening;
          // Cancellation cannot undo a durable create/reopen, but it must not move focus later.
          if (signal?.aborted) return workspace;
          await getWorkspaceApi().setActiveWorkspaceId(workspace.id);
          if (signal?.aborted) {
            await getWorkspaceApi().setActiveWorkspaceId(get().activeWorkspaceId);
            return workspace;
          }
          if (!get().workspaces.some((current) => current.id === workspace.id)) {
            throw new Error('Project was deleted while opening');
          }
          set({ activeWorkspaceId: workspace.id, error: null });
          return workspace;
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
          throw error;
        }
      },
      deleteWorkspace: async (id: string): Promise<void> => {
        const state = get();
        const target = state.workspaces.find((w) => w.id === id);
        if (!target || !canDeleteWorkspace(target)) {
          return;
        }
        try {
          await getWorkspaceApi().delete(id);
          const remainingWorkspaces = state.workspaces.filter((w) => w.id !== id);
          const newActiveId =
            state.activeWorkspaceId === id
              ? (findFallbackWorkspace(remainingWorkspaces)?.id ?? null)
              : state.activeWorkspaceId;
          set({ workspaces: remainingWorkspaces, activeWorkspaceId: newActiveId });
          void getWorkspaceApi().setActiveWorkspaceId(newActiveId);
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
        }
      },
      renameWorkspace: (id: string, name: string): void => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          return;
        }
        const workspace = get().workspaces.find((w) => w.id === id);
        if (!workspace || workspace.name === trimmedName) {
          return;
        }
        get().updateWorkspace({ ...workspace, name: trimmedName });
      },
      addTab: (): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace) {
          return;
        }

        get().addWorkspaceTab(workspace.id);
      },
      addWorkspaceTab: (workspaceId: string): void => {
        const shouldSwitchWorkspace = get().activeWorkspaceId !== workspaceId;
        const workspace = findOpenWorkspace(get().workspaces, workspaceId);
        if (!workspace || workspace.tabs.length >= MAX_WORKSPACE_TABS) {
          return;
        }

        const cwd = workspace.rootPath;
        const tabName = getAutomaticTabName(cwd);
        const { pane, tab } = createTabWithPane(createStoreId, { cwd, tabName });
        const updatedWorkspace: Workspace = {
          ...workspace,
          tabs: [...workspace.tabs, tab],
          panes: [...workspace.panes, pane],
          activeTabId: tab.id,
        };

        get().updateWorkspace(updatedWorkspace);
        if (shouldSwitchWorkspace) {
          set({ activeWorkspaceId: workspace.id });
          void getWorkspaceApi().setActiveWorkspaceId(workspace.id);
        }
      },
      renameTab: (tabId: string, name: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace) {
          return;
        }

        get().renameWorkspaceTab(workspace.id, tabId, name);
      },
      renameWorkspaceTab: (workspaceId: string, tabId: string, name: string): void => {
        const trimmedName = name.trim();
        if (!trimmedName) {
          return;
        }

        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
        if (!workspace) {
          return;
        }

        const tab = workspace.tabs.find((currentTab) => currentTab.id === tabId);
        if (!tab || (tab.name === trimmedName && tab.isCustomName)) {
          return;
        }

        get().updateWorkspace(
          replaceTab(workspace, {
            ...tab,
            name: trimmedName,
            isCustomName: true,
          }),
        );
      },
      openSshHostTab: (alias: string): void => {
        const state = get();
        const workspace = selectActiveWorkspace(state);
        const activePane = selectActivePane(state);
        if (!workspace || workspace.tabs.length >= MAX_WORKSPACE_TABS) {
          return;
        }

        const cwd = activePane?.cwd ?? workspace.rootPath;
        // SSH aliases come from ~/.ssh/config, but the command is injected into a shell. Quoting
        // keeps unusual Host aliases from being interpreted as shell syntax.
        const initialCommand = `ssh ${shellQuote(alias)}`;
        const { pane, tab } = createTabWithPane(createStoreId, {
          cwd,
          initialCommand,
          isCustomName: true,
          tabName: alias,
        });

        get().updateWorkspace({
          ...workspace,
          tabs: [...workspace.tabs, tab],
          panes: [...workspace.panes, pane],
          activeTabId: tab.id,
        });
      },
      selectWorkspaceTab: (workspaceId: string, tabId: string): void => {
        const workspace = findOpenWorkspace(get().workspaces, workspaceId);
        if (!workspace) {
          return;
        }

        const selectedTab = workspace.tabs.find((tab) => tab.id === tabId);
        if (!selectedTab) {
          return;
        }

        const shouldSwitchWorkspace = get().activeWorkspaceId !== workspace.id;
        const shouldSelectTab = workspace.activeTabId !== selectedTab.id;

        if (!shouldSwitchWorkspace && !shouldSelectTab) {
          return;
        }

        if (!shouldSelectTab) {
          set({ activeWorkspaceId: workspace.id });
          void getWorkspaceApi().setActiveWorkspaceId(workspace.id);
          return;
        }

        const updatedWorkspace = updateWorkspaceState({
          ...workspace,
          activeTabId: selectedTab.id,
        });
        if (shouldSwitchWorkspace) {
          // Sidebar tab selection can target an inactive workspace. `updateWorkspaceState()` only
          // preserves or initializes the active id, so switching workspace remains explicit here.
          set({ activeWorkspaceId: updatedWorkspace.id });
          void getWorkspaceApi().setActiveWorkspaceId(updatedWorkspace.id);
        }
        persistWorkspaceDebounced(updatedWorkspace.id);
      },
      selectWorkspacePane: (workspaceId: string, tabId: string, paneId: string): void => {
        const workspace = findOpenWorkspace(get().workspaces, workspaceId);
        if (!workspace) {
          return;
        }

        const selectedTab = workspace.tabs.find((tab) => tab.id === tabId);
        if (!selectedTab) {
          return;
        }

        const selectedPane = workspace.panes.find((pane) => pane.id === paneId);
        if (!collectPaneIds(selectedTab.layout).includes(paneId) || !selectedPane) {
          return;
        }

        const shouldSwitchWorkspace = get().activeWorkspaceId !== workspace.id;
        const shouldSelectTab = workspace.activeTabId !== selectedTab.id;
        const shouldSelectPane = selectedTab.activePaneId !== paneId;

        if (!shouldSwitchWorkspace && !shouldSelectTab && !shouldSelectPane) {
          return;
        }

        if (!shouldSelectTab && !shouldSelectPane) {
          set({ activeWorkspaceId: workspace.id });
          void getWorkspaceApi().setActiveWorkspaceId(workspace.id);
          // Workspace switches but the target tab/pane already match: skip workspace-store update,
          // which avoids invalidating React identity for the panes/tabs of the (previously inactive) workspace.
          return;
        }

        const updatedWorkspace = updateWorkspaceState(
          replaceTab(
            {
              ...workspace,
              activeTabId: selectedTab.id,
            },
            {
              ...setTabActivePane(selectedTab, selectedPane),
            },
          ),
        );

        if (shouldSwitchWorkspace) {
          set({ activeWorkspaceId: updatedWorkspace.id });
          void getWorkspaceApi().setActiveWorkspaceId(updatedWorkspace.id);
        }
        persistWorkspaceDebounced(updatedWorkspace.id);
      },
      selectTab: (tabId: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace) {
          return;
        }

        get().selectWorkspaceTab(workspace.id, tabId);
      },
      closeWorkspaceTab: (workspaceId: string, tabId: string): void => {
        const workspace = get().workspaces.find((current) => current.id === workspaceId);
        if (!workspace) {
          return;
        }

        const updatedWorkspace = removeTab(workspace, tabId);
        if (updatedWorkspace) {
          get().updateWorkspace(updatedWorkspace);
        }
      },
      reorderWorkspaceTab: (workspaceId: string, tabId: string, toIndex: number): void => {
        const workspace = get().workspaces.find((current) => current.id === workspaceId);
        if (!workspace) {
          return;
        }

        const updatedWorkspace = reorderTab(workspace, tabId, toIndex);
        if (updatedWorkspace) {
          get().updateWorkspace(updatedWorkspace);
        }
      },
      moveTabToWorkspace: (
        sourceWorkspaceId: string,
        tabId: string,
        targetWorkspaceId: string,
        toIndex?: number,
      ): void => {
        if (sourceWorkspaceId === targetWorkspaceId) {
          return;
        }

        const state = get();
        // Both ends must be open: panes moved into a closed workspace would unmount and lose their
        // live PTYs without the tab-close confirmation.
        const sourceWorkspace = findOpenWorkspace(state.workspaces, sourceWorkspaceId);
        const targetWorkspace = findOpenWorkspace(state.workspaces, targetWorkspaceId);
        if (!sourceWorkspace || !targetWorkspace) {
          return;
        }

        const transfer = prepareTabTransfer(sourceWorkspace, targetWorkspace, tabId);
        if (!transfer) {
          return;
        }

        const shouldFollowMovedTab =
          state.activeWorkspaceId === sourceWorkspace.id && sourceWorkspace.activeTabId === tabId;
        const targetTabIds = new Set(targetWorkspace.tabs.map((tab) => tab.id));
        const targetPaneIds = new Set(targetWorkspace.panes.map((pane) => pane.id));

        // Allocate only after validation, retrying collisions including ids allocated earlier in
        // this transfer. The workspace transformation receives values rather than a random factory.
        let movedTabId = transfer.tabId;
        while (targetTabIds.has(movedTabId)) {
          movedTabId = createStoreId();
        }
        const paneIdByOldId = new Map<string, string>();
        for (const paneId of transfer.paneIds) {
          let nextPaneId = paneId;
          while (targetPaneIds.has(nextPaneId)) {
            nextPaneId = createStoreId();
          }
          targetPaneIds.add(nextPaneId);
          paneIdByOldId.set(paneId, nextPaneId);
        }

        const result = transferTab(sourceWorkspace, targetWorkspace, tabId, {
          movedTabId,
          paneIdByOldId,
          toIndex,
        });
        if (!result) {
          return;
        }
        const { source: updatedSource, target: updatedTarget } = result;

        updateWorkspacesState(
          [updatedSource, updatedTarget],
          shouldFollowMovedTab ? updatedTarget.id : undefined,
        );
        if (shouldFollowMovedTab) {
          void getWorkspaceApi().setActiveWorkspaceId(updatedTarget.id);
        }
        persistWorkspaceDebounced(updatedSource.id);
        persistWorkspaceDebounced(updatedTarget.id);
      },
      createTabFromPane: (workspaceId: string, sourceTabId: string, paneId: string): void => {
        const shouldSwitchWorkspace = get().activeWorkspaceId !== workspaceId;
        const workspace = findOpenWorkspace(get().workspaces, workspaceId);
        // Check before allocating: rejected actions must not consume ids or schedule persistence.
        if (!workspace || !preparePaneExtraction(workspace, sourceTabId, paneId)) {
          return;
        }

        const updatedWorkspace = extractPaneToTab(workspace, sourceTabId, paneId, createStoreId());
        if (!updatedWorkspace) {
          return;
        }
        get().updateWorkspace(updatedWorkspace);

        if (shouldSwitchWorkspace) {
          set({ activeWorkspaceId: workspaceId });
          void getWorkspaceApi().setActiveWorkspaceId(workspaceId);
        }
      },
      setActivePane: (paneId: string): void => {
        const workspace = selectActiveWorkspace(get());
        const tab = selectActiveTab(get());
        if (!workspace || !tab || tab.activePaneId === paneId) {
          return;
        }

        const pane = workspace.panes.find((currentPane) => currentPane.id === paneId);
        if (!collectPaneIds(tab.layout).includes(paneId) || !pane) {
          return;
        }

        get().updateWorkspace(replaceTab(workspace, setTabActivePane(tab, pane)));
      },
      setPanePtyId: (paneId: string, ptyId: string | null): void => {
        set((state) => ({
          workspaces: state.workspaces.map((workspace) => ({
            ...workspace,
            panes: workspace.panes.map((pane) => {
              if (pane.id !== paneId) {
                return pane;
              }

              if (ptyId === null) {
                const { ptyId: _ptyId, ...paneWithoutPtyId } = pane;
                return paneWithoutPtyId;
              }

              return { ...pane, ptyId };
            }),
          })),
        }));
      },
      splitActivePane: (direction: SplitDirection): void => {
        const activePane = selectActivePane(get());
        if (!activePane) {
          return;
        }

        get().splitPane(activePane.id, direction);
      },
      selectAdjacentTab: (direction: TabSelectionDirection): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace || workspace.tabs.length <= 1) {
          return;
        }

        const activeTabId = workspace.activeTabId;
        const currentIndex = activeTabId
          ? workspace.tabs.findIndex((tab) => tab.id === activeTabId)
          : -1;
        // Fall back to the first tab when no tab is active so the user still gets a deterministic
        // move on the first invocation. `tabs.length` is guaranteed > 1 here, so the modulo
        // arithmetic below is safe.
        const startIndex = currentIndex >= 0 ? currentIndex : 0;
        const delta = direction === 'next' ? 1 : -1;
        const length = workspace.tabs.length;
        const nextIndex = (startIndex + delta + length) % length;
        const targetTab = workspace.tabs[nextIndex];
        if (!targetTab || targetTab.id === activeTabId) {
          return;
        }

        get().selectWorkspaceTab(workspace.id, targetTab.id);
      },
      selectAdjacentTabGlobal: (direction: TabSelectionDirection): void => {
        const state = get();
        // Only open workspaces can be selected; including closed tabs would stall navigation at
        // the first rejected destination. Flatten open tabs so workspace boundaries do not interrupt
        // next/previous navigation, skipping workspaces with zero tabs.
        const entries: { workspaceId: string; tabId: string }[] = [];
        for (const workspace of getOpenWorkspaces(state.workspaces)) {
          for (const tab of workspace.tabs) {
            entries.push({ workspaceId: workspace.id, tabId: tab.id });
          }
        }
        if (entries.length <= 1) {
          return;
        }

        const activeWorkspace = selectActiveWorkspace(state);
        const activeTab = selectActiveTab(state);
        const currentIndex =
          activeWorkspace && activeTab
            ? entries.findIndex(
                (entry) => entry.workspaceId === activeWorkspace.id && entry.tabId === activeTab.id,
              )
            : -1;
        // Fall back to the first entry when nothing is active so the first invocation still moves
        // deterministically. `entries.length` is guaranteed > 1, so the modulo math is safe.
        const startIndex = currentIndex >= 0 ? currentIndex : 0;
        const delta = direction === 'next' ? 1 : -1;
        const length = entries.length;
        const nextIndex = (startIndex + delta + length) % length;
        const target = entries[nextIndex];
        if (!target) {
          return;
        }
        if (
          currentIndex >= 0 &&
          target.workspaceId === entries[currentIndex]?.workspaceId &&
          target.tabId === entries[currentIndex]?.tabId
        ) {
          return;
        }

        get().selectWorkspaceTab(target.workspaceId, target.tabId);
      },
      focusAdjacentPane: (direction: PaneFocusDirection): void => {
        const state = get();
        const workspace = selectActiveWorkspace(state);
        const tab = selectActiveTab(state);
        const activePane = selectActivePane(state);
        if (!workspace || !tab || !activePane) {
          return;
        }

        const targetPaneId = findAdjacentPaneId(tab.layout, activePane.id, direction);
        if (!targetPaneId) {
          return;
        }

        get().setActivePane(targetPaneId);
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
        };
        const updatedTab: Tab = {
          ...setTabActivePane(tab, newPane),
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
        };

        get().updateWorkspace({
          ...replaceTab(workspace, updatedTab),
          panes: [...workspace.panes, newPane],
        });
      },
      closePane: (paneId: string): void => {
        let targetWorkspace: Workspace | null = null;
        let targetTab: Tab | null = null;

        for (const workspace of get().workspaces) {
          const tab = workspace.tabs.find((t) => collectPaneIds(t.layout).includes(paneId));
          if (tab) {
            targetWorkspace = workspace;
            targetTab = tab;
            break;
          }
        }

        if (!targetWorkspace || !targetTab) {
          return;
        }

        const removedLayout = removePaneLayout(targetTab.layout, paneId);
        if (!removedLayout.removed || !removedLayout.layout) {
          return;
        }

        const remainingPaneIds = new Set(collectPaneIds(removedLayout.layout));
        const activePaneId =
          targetTab.activePaneId && remainingPaneIds.has(targetTab.activePaneId)
            ? targetTab.activePaneId
            : findFirstPaneId(removedLayout.layout);
        const activePane = targetWorkspace.panes.find((pane) => pane.id === activePaneId);
        const updatedTab: Tab = {
          ...(activePane ? setTabActivePane(targetTab, activePane) : targetTab),
          layout: removedLayout.layout,
          activePaneId,
        };

        get().updateWorkspace({
          ...replaceTab(targetWorkspace, updatedTab),
          panes: targetWorkspace.panes.filter((pane) => pane.id !== paneId),
        });
      },
      closePaneOnExit: (paneId: string): void => {
        let targetWorkspace: Workspace | null = null;
        let targetTab: Tab | null = null;

        for (const workspace of get().workspaces) {
          const tab = workspace.tabs.find((t) => collectPaneIds(t.layout).includes(paneId));
          if (tab) {
            targetWorkspace = workspace;
            targetTab = tab;
            break;
          }
        }

        if (!targetWorkspace || !targetTab) {
          return;
        }

        const paneIds = collectPaneIds(targetTab.layout);

        // Tab still has siblings: behave exactly like the manual close-pane action.
        if (paneIds.length > 1) {
          get().closePane(paneId);
          return;
        }

        // Last pane in the tab: close the tab itself, unless it is the only tab in the workspace.
        // `closeWorkspaceTab` already refuses to close the final tab, so the workspace cannot end up
        // without any tabs through this path.
        if (targetWorkspace.tabs.length > 1) {
          get().closeWorkspaceTab(targetWorkspace.id, targetTab.id);
        }
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

        applyCwdUpdate(workspace, paneId, cwd);
      },
      updatePaneCwdByPtyId: (ptyId: string, cwd: string): void => {
        // All open workspaces stay mounted (see `MainTerminalArea`) and closed ones hold no PTY ids,
        // so a PTY id is unique across the whole renderer process. Stop at the first match to avoid
        // scanning further workspaces.
        for (const workspace of get().workspaces) {
          const pane = workspace.panes.find((currentPane) => currentPane.ptyId === ptyId);
          if (!pane) {
            continue;
          }

          applyCwdUpdate(workspace, pane.id, cwd);
          return;
        }
      },
      updateWorkspace: (workspace: Workspace): void => {
        const updatedWorkspace = updateWorkspaceState(workspace);
        persistWorkspaceDebounced(updatedWorkspace.id);
      },
    };
  });
}

/**
 * App-wide singleton workspace store. The renderer treats this as the single source of truth for
 * workspace runtime state and reads it directly from React components / hooks.
 *
 * **Tests must use {@link createWorkspaceStore} to construct an isolated store per test** rather
 * than reusing this singleton, otherwise state bleeds across tests run in parallel and stale
 * subscriptions can fire after a test completes. The factory is also the right entry point if the
 * renderer later wraps stores in a React Context provider; the singleton is then created from
 * `createWorkspaceStore()` once at the provider boundary instead of at module load.
 */
export const useWorkspaceStore = createWorkspaceStore();
