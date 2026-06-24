import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { flattenLayout, type PaneRect } from '../../../shared/pane-layout';
import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from '../../../shared/pane-layout-constants';
import { getPathBasename } from '../../../shared/path-label';
import type { Pane, PaneLayout, Tab, Workspace } from '../../../shared/types';

const DEFAULT_SAVE_DEBOUNCE_MS = 300;
const DEFAULT_CWD_SAVE_DEBOUNCE_MS = 1000;
const DEFAULT_SPLIT_RATIO = 0.5;
/**
 * Tolerance for comparing pane edge positions in container-percentage units. `flattenLayout`
 * produces values derived from float multiplication on `ratio`, so exact equality cannot be
 * assumed; 0.01 percentage points is well below any pane size the renderer can produce.
 */
const PANE_EDGE_EPSILON_PCT = 0.01;

type WorkspaceApi = Window['api']['workspace'];
type SplitDirection = Extract<PaneLayout, { type: 'split' }>['direction'];
export type TabSelectionDirection = 'next' | 'previous';
export type PaneFocusDirection = 'left' | 'right' | 'up' | 'down';

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
  createWorkspace: (name: string) => Promise<void>;
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
  closeTab: (tabId: string) => void;
  closeWorkspaceTab: (workspaceId: string, tabId: string) => void;
  /**
   * Reorders a tab within its workspace by moving it to `toIndex` (clamped to the valid range).
   * No-op when the workspace or tab is missing or the tab is already at the target index. The
   * primitive is index based rather than direction based so it backs both the menu (which computes
   * the previous / next index) and any future drag-and-drop reordering without a second action.
   */
  reorderWorkspaceTab: (workspaceId: string, tabId: string, toIndex: number) => void;
  /**
   * Moves a tab and the panes it owns from `sourceWorkspaceId` to `targetWorkspaceId`, appending it
   * to the target's tab list and making it the target's active tab. No-op when either workspace or
   * the tab is missing, when source equals target, or when the tab is the only one left in the
   * source workspace (the "at least one tab" invariant mirrors {@link closeWorkspaceTab}). The
   * source's active tab advances by the same rule as a tab close, and both workspaces are persisted.
   *
   * The moved panes keep their runtime `ptyId` on purpose. `MainTerminalArea` mounts every tab in a
   * single list keyed by `tab.id`, so a moved tab keeps its React identity and its terminals are not
   * unmounted — the live PTY survives the move. Carrying `ptyId` here keeps the moved pane in sync
   * with that still-running terminal; dropping it would desync the pane from its live PTY.
   */
  moveTabToWorkspace: (sourceWorkspaceId: string, tabId: string, targetWorkspaceId: string) => void;
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
   * Moves focus to the pane geometrically adjacent to the active pane in the given direction.
   *
   * Selection algorithm: candidates are panes whose facing edge aligns with the active pane's edge
   * in `direction` (within {@link PANE_EDGE_EPSILON_PCT}). Among those candidates, the one with
   * the largest overlap on the perpendicular axis wins; ties are broken by smaller center
   * distance. The active pane never wraps — if no candidate touches the edge (single pane or
   * outermost pane in `direction`), this is a no-op.
   */
  focusAdjacentPane: (direction: PaneFocusDirection) => void;
  closePane: (paneId: string) => void;
  /**
   * Closes the active workspace's active tab. No-op when there is no active workspace, no active
   * tab, or only one tab remains (mirrors {@link closeWorkspaceTab}). Used by the menu-driven
   * shortcut dispatcher.
   */
  closeActiveTab: () => void;
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
   * workspaces (every workspace stays mounted, see `MainTerminalArea`) and forwards to the same
   * cwd update path as {@link updatePaneCwd}.
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

function remapPaneLayoutIds(layout: PaneLayout, paneIdByOldId: Map<string, string>): PaneLayout {
  if (layout.type === 'leaf') {
    return {
      ...layout,
      paneId: paneIdByOldId.get(layout.paneId) ?? layout.paneId,
    };
  }

  return {
    ...layout,
    children: [
      remapPaneLayoutIds(layout.children[0], paneIdByOldId),
      remapPaneLayoutIds(layout.children[1], paneIdByOldId),
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

function rectsTouch(active: PaneRect, candidate: PaneRect, direction: PaneFocusDirection): boolean {
  switch (direction) {
    case 'left':
      return (
        Math.abs(candidate.leftPct + candidate.widthPct - active.leftPct) <= PANE_EDGE_EPSILON_PCT
      );
    case 'right':
      return (
        Math.abs(candidate.leftPct - (active.leftPct + active.widthPct)) <= PANE_EDGE_EPSILON_PCT
      );
    case 'up':
      return (
        Math.abs(candidate.topPct + candidate.heightPct - active.topPct) <= PANE_EDGE_EPSILON_PCT
      );
    case 'down':
      return (
        Math.abs(candidate.topPct - (active.topPct + active.heightPct)) <= PANE_EDGE_EPSILON_PCT
      );
  }
}

function perpendicularOverlap(
  active: PaneRect,
  candidate: PaneRect,
  direction: PaneFocusDirection,
): number {
  if (direction === 'left' || direction === 'right') {
    const top = Math.max(active.topPct, candidate.topPct);
    const bottom = Math.min(
      active.topPct + active.heightPct,
      candidate.topPct + candidate.heightPct,
    );
    return bottom - top;
  }
  const left = Math.max(active.leftPct, candidate.leftPct);
  const right = Math.min(active.leftPct + active.widthPct, candidate.leftPct + candidate.widthPct);
  return right - left;
}

function centerDistance(a: PaneRect, b: PaneRect): number {
  const ax = a.leftPct + a.widthPct / 2;
  const ay = a.topPct + a.heightPct / 2;
  const bx = b.leftPct + b.widthPct / 2;
  const by = b.topPct + b.heightPct / 2;
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Returns the pane id geometrically adjacent to `activePaneId` in `direction`, or `null` when no
 * candidate touches the active pane's facing edge. See `focusAdjacentPane`'s JSDoc for the full
 * selection rule.
 */
export function findAdjacentPaneId(
  layout: PaneLayout,
  activePaneId: string,
  direction: PaneFocusDirection,
): string | null {
  const { panes } = flattenLayout(layout);
  const activeRect = panes.find((rect) => rect.paneId === activePaneId);
  if (!activeRect) {
    return null;
  }

  let best: { paneId: string; overlap: number; distance: number } | null = null;
  for (const candidate of panes) {
    if (candidate.paneId === activePaneId) {
      continue;
    }
    if (!rectsTouch(activeRect, candidate, direction)) {
      continue;
    }
    const overlap = perpendicularOverlap(activeRect, candidate, direction);
    if (overlap <= PANE_EDGE_EPSILON_PCT) {
      continue;
    }
    const distance = centerDistance(activeRect, candidate);
    if (
      !best ||
      overlap > best.overlap + PANE_EDGE_EPSILON_PCT ||
      (Math.abs(overlap - best.overlap) <= PANE_EDGE_EPSILON_PCT && distance < best.distance)
    ) {
      best = { paneId: candidate.paneId, overlap, distance };
    }
  }

  return best?.paneId ?? null;
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

function findWorkspaceActivePane(workspace: Workspace): Pane | null {
  const activeTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
  const activePaneId =
    activeTab?.activePaneId ?? (activeTab ? findFirstPaneId(activeTab.layout) : null);

  return workspace.panes.find((pane) => pane.id === activePaneId) ?? null;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface CreateTabWithPaneOptions {
  cwd: string;
  initialCommand?: string;
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
      layout: {
        type: 'leaf',
        paneId,
      },
      activePaneId: paneId,
    },
  };
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

      const updatedWorkspace = updateWorkspaceState({
        ...workspace,
        panes: workspace.panes.map((currentPane) =>
          currentPane.id === paneId ? { ...currentPane, cwd } : currentPane,
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
          // Validate that the persisted id still refers to a known workspace.
          const activeWorkspaceId =
            workspaces.find((workspace) => workspace.id === persistedActiveId)?.id ??
            workspaces[0]?.id ??
            null;

          set({ workspaces, activeWorkspaceId, isLoading: false });
        } catch (error: unknown) {
          set({ error: getErrorMessage(error), isLoading: false });
        }
      },
      setActiveWorkspace: (id: string): void => {
        set({ activeWorkspaceId: id });
        void getWorkspaceApi().setActiveWorkspaceId(id);
      },
      createWorkspace: async (name: string): Promise<void> => {
        const trimmedName = name.trim() || 'Workspace';
        try {
          // Pass empty rootPath so the main process defaults to the home directory.
          const workspace = await getWorkspaceApi().create(trimmedName, '');
          set((state) => ({
            workspaces: [...state.workspaces, workspace],
            activeWorkspaceId: workspace.id,
          }));
          void getWorkspaceApi().setActiveWorkspaceId(workspace.id);
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
        }
      },
      deleteWorkspace: async (id: string): Promise<void> => {
        const state = get();
        if (state.workspaces.length <= 1) {
          return;
        }
        try {
          await getWorkspaceApi().delete(id);
          const remainingWorkspaces = state.workspaces.filter((w) => w.id !== id);
          const newActiveId =
            state.activeWorkspaceId === id
              ? (remainingWorkspaces[0]?.id ?? null)
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
        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
        if (!workspace) {
          return;
        }

        const activePane = findWorkspaceActivePane(workspace);
        const cwd = activePane?.cwd ?? workspace.rootPath;
        const tabName = getPathBasename(cwd, { emptyFallback: 'Tab', rootFallback: 'Tab' });
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
        if (!tab || tab.name === trimmedName) {
          return;
        }

        get().updateWorkspace(
          replaceTab(workspace, {
            ...tab,
            name: trimmedName,
          }),
        );
      },
      openSshHostTab: (alias: string): void => {
        const state = get();
        const workspace = selectActiveWorkspace(state);
        const activePane = selectActivePane(state);
        if (!workspace) {
          return;
        }

        const cwd = activePane?.cwd ?? workspace.rootPath;
        // SSH aliases come from ~/.ssh/config, but the command is injected into a shell. Quoting
        // keeps unusual Host aliases from being interpreted as shell syntax.
        const initialCommand = `ssh ${shellQuote(alias)}`;
        const { pane, tab } = createTabWithPane(createStoreId, {
          cwd,
          initialCommand,
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
        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
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
        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
        if (!workspace) {
          return;
        }

        const selectedTab = workspace.tabs.find((tab) => tab.id === tabId);
        if (!selectedTab) {
          return;
        }

        if (
          !collectPaneIds(selectedTab.layout).includes(paneId) ||
          !workspace.panes.some((pane) => pane.id === paneId)
        ) {
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
              ...selectedTab,
              activePaneId: paneId,
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
      closeTab: (tabId: string): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace) {
          return;
        }

        get().closeWorkspaceTab(workspace.id, tabId);
      },
      closeWorkspaceTab: (workspaceId: string, tabId: string): void => {
        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
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
      reorderWorkspaceTab: (workspaceId: string, tabId: string, toIndex: number): void => {
        const workspace = get().workspaces.find(
          (currentWorkspace) => currentWorkspace.id === workspaceId,
        );
        if (!workspace) {
          return;
        }

        const fromIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
        if (fromIndex === -1) {
          return;
        }

        // Clamp so an out-of-range target (e.g. "move left" on the first tab) is a no-op instead of
        // throwing the tab off the ends of the list.
        const clampedIndex = Math.min(Math.max(toIndex, 0), workspace.tabs.length - 1);
        if (clampedIndex === fromIndex) {
          return;
        }

        const nextTabs = [...workspace.tabs];
        const [movedTab] = nextTabs.splice(fromIndex, 1);
        nextTabs.splice(clampedIndex, 0, movedTab);

        get().updateWorkspace({ ...workspace, tabs: nextTabs });
      },
      moveTabToWorkspace: (
        sourceWorkspaceId: string,
        tabId: string,
        targetWorkspaceId: string,
      ): void => {
        if (sourceWorkspaceId === targetWorkspaceId) {
          return;
        }

        const state = get();
        const sourceWorkspace = state.workspaces.find(
          (currentWorkspace) => currentWorkspace.id === sourceWorkspaceId,
        );
        const targetWorkspace = state.workspaces.find(
          (currentWorkspace) => currentWorkspace.id === targetWorkspaceId,
        );
        if (!sourceWorkspace || !targetWorkspace) {
          return;
        }

        // A workspace must never become empty; refuse to move out its last remaining tab.
        if (sourceWorkspace.tabs.length <= 1) {
          return;
        }

        const movingTab = sourceWorkspace.tabs.find((tab) => tab.id === tabId);
        if (!movingTab) {
          return;
        }

        const shouldFollowMovedTab =
          state.activeWorkspaceId === sourceWorkspace.id && sourceWorkspace.activeTabId === tabId;

        const targetTabIds = new Set(targetWorkspace.tabs.map((tab) => tab.id));
        const targetPaneIds = new Set(targetWorkspace.panes.map((pane) => pane.id));

        // A tab owns every pane its layout references; the panes travel with the tab so the target
        // workspace can resolve the moved layout's `paneId`s. Pane and tab ids are only scoped by
        // convention, so crossing a workspace boundary must resolve collisions before both sets are
        // merged into one target workspace. Tab and pane ids retry the same way (keep drawing a
        // fresh id until it is unique) rather than assuming a single replacement never collides.
        let movedTabId = movingTab.id;
        while (targetTabIds.has(movedTabId)) {
          movedTabId = createStoreId();
        }

        const movingPaneIds = new Set(collectPaneIds(movingTab.layout));
        const paneIdByOldId = new Map<string, string>();
        for (const paneId of movingPaneIds) {
          let nextPaneId = paneId;
          while (targetPaneIds.has(nextPaneId)) {
            nextPaneId = createStoreId();
          }
          targetPaneIds.add(nextPaneId);
          paneIdByOldId.set(paneId, nextPaneId);
        }
        const movedTab: Tab = {
          ...movingTab,
          id: movedTabId,
          layout: remapPaneLayoutIds(movingTab.layout, paneIdByOldId),
          activePaneId: movingTab.activePaneId
            ? (paneIdByOldId.get(movingTab.activePaneId) ?? movingTab.activePaneId)
            : movingTab.activePaneId,
        };
        const movingPanes = sourceWorkspace.panes
          .filter((pane) => movingPaneIds.has(pane.id))
          .map((pane) => ({
            // Spread keeps runtime fields (`ptyId` / `initialCommand`); the `ptyId` must stay so the
            // moved pane keeps matching its still-running terminal. See `moveTabToWorkspace`'s JSDoc.
            ...pane,
            id: paneIdByOldId.get(pane.id) ?? pane.id,
          }));

        const updatedSource: Workspace = {
          ...sourceWorkspace,
          tabs: sourceWorkspace.tabs.filter((tab) => tab.id !== tabId),
          panes: sourceWorkspace.panes.filter((pane) => !movingPaneIds.has(pane.id)),
          activeTabId:
            sourceWorkspace.activeTabId === tabId
              ? selectNextTabIdAfterClose(sourceWorkspace, tabId)
              : sourceWorkspace.activeTabId,
        };

        const updatedTarget: Workspace = {
          ...targetWorkspace,
          tabs: [...targetWorkspace.tabs, movedTab],
          panes: [...targetWorkspace.panes, ...movingPanes],
          // A moved tab always becomes active in its new home, regardless of whether the move
          // follows focus there. This keeps the rule simple and matches direct-manipulation (future
          // drag-and-drop) intuition: the tab you just placed is the one shown when you arrive.
          activeTabId: movedTab.id,
        };

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
        // Flatten every workspace's tabs into a single ordered list so workspace boundaries do not
        // interrupt next/previous navigation. Workspaces with zero tabs are skipped here so the
        // modulo arithmetic below never lands on an empty workspace.
        const entries: { workspaceId: string; tabId: string }[] = [];
        for (const workspace of state.workspaces) {
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
      closeActiveTab: (): void => {
        const workspace = selectActiveWorkspace(get());
        if (!workspace || !workspace.activeTabId) {
          return;
        }

        get().closeWorkspaceTab(workspace.id, workspace.activeTabId);
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
        const updatedTab: Tab = {
          ...targetTab,
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
        // All workspaces stay mounted (see `MainTerminalArea`), so a PTY id is unique across the
        // whole renderer process. Stop at the first match to avoid scanning further workspaces.
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
