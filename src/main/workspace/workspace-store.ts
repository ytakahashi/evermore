import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import type { Pane, PaneLayout, Tab, Workspace } from '../../shared/types';
import { createSilentLogger, type Logger } from '../logging/logger';
import type { WorkspaceStorageAdapter, WorkspaceStoreOptions } from './types';

interface WorkspaceStoreSchema extends Record<string, unknown> {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

class ElectronWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  private readonly store: Store<WorkspaceStoreSchema>;

  public constructor() {
    this.store = new Store<WorkspaceStoreSchema>({
      name: 'workspaces',
      defaults: {
        workspaces: [],
        activeWorkspaceId: null,
      },
    });
  }

  public getWorkspaces(): Workspace[] {
    return this.store.get('workspaces');
  }

  public setWorkspaces(workspaces: Workspace[]): void {
    this.store.set('workspaces', workspaces);
  }

  public getActiveWorkspaceId(): string | null {
    return this.store.get('activeWorkspaceId');
  }

  public setActiveWorkspaceId(id: string | null): void {
    this.store.set('activeWorkspaceId', id);
  }
}

type LegacyPane = Pane & { title?: string };
type LegacyTab = Omit<Tab, 'name'> & { name?: string; title?: string };
type LegacyWorkspace = Omit<Workspace, 'panes' | 'tabs'> & {
  panes: LegacyPane[];
  tabs: LegacyTab[];
};

function sanitizePane(pane: LegacyPane): Pane {
  const { ptyId: _ptyId, initialCommand: _initialCommand, title: _title, ...persistedPane } = pane;
  return persistedPane;
}

function sanitizeTab(tab: LegacyTab): Tab {
  const legacyName = typeof tab.name === 'string' ? tab.name.trim() : '';
  const legacyTitle = typeof tab.title === 'string' ? tab.title.trim() : '';

  return {
    id: tab.id,
    name: legacyName || legacyTitle || 'Tab',
    layout: tab.layout,
    activePaneId: tab.activePaneId,
  };
}

function sanitizeWorkspace(workspace: Workspace | LegacyWorkspace): Workspace {
  return {
    ...workspace,
    tabs: workspace.tabs.map(sanitizeTab),
    panes: workspace.panes.map(sanitizePane),
  };
}

function collectLayoutPaneIds(layout: PaneLayout): string[] {
  if (layout.type === 'leaf') {
    return [layout.paneId];
  }

  return [...collectLayoutPaneIds(layout.children[0]), ...collectLayoutPaneIds(layout.children[1])];
}

function mapLayoutPaneIds(layout: PaneLayout, mapPaneId: (paneId: string) => string): PaneLayout {
  if (layout.type === 'leaf') {
    return { ...layout, paneId: mapPaneId(layout.paneId) };
  }

  return {
    ...layout,
    children: [
      mapLayoutPaneIds(layout.children[0], mapPaneId),
      mapLayoutPaneIds(layout.children[1], mapPaneId),
    ],
  };
}

/**
 * A workspace is consistent when its panes and layouts satisfy the same invariants the
 * `workspace:update` validator enforces: pane ids are unique within the workspace, and every pane is
 * referenced by exactly one layout leaf (no orphan panes, no leaf pointing at a missing or shared
 * pane). Such a workspace only needs cross-workspace collision handling, not a structural rebuild.
 */
function isWorkspaceInternallyConsistent(workspace: Workspace): boolean {
  const paneIds = new Set(workspace.panes.map((pane) => pane.id));
  if (paneIds.size !== workspace.panes.length) {
    return false;
  }

  const leafIds = workspace.tabs.flatMap((tab) => collectLayoutPaneIds(tab.layout));
  if (leafIds.length !== paneIds.size || new Set(leafIds).size !== leafIds.length) {
    return false;
  }

  return leafIds.every((leafId) => paneIds.has(leafId));
}

/**
 * Guarantees that every `pane.id` is unique across all persisted workspaces.
 *
 * The renderer's terminal runtime keys live PTYs/terminals by `pane.id` across every workspace, so a
 * pane id repeated in two workspaces would let one workspace's pane bind to another's terminal. Pane
 * ids are unique within a workspace by construction, so the realistic source of duplication is
 * persisted data from older builds (or a future workspace-copy feature) repeating an id across
 * workspaces.
 *
 * Design decisions:
 *   - This runs on the main process (the durable-model owner). `ensureWorkspaces` writes the result
 *     back when it changes, so the fix is persisted and the renderer always receives clean data;
 *     normalizing only in the renderer would re-run every launch without ever curing the data.
 *   - Inconsistent input is *self-healed*, never thrown. `ensureWorkspaces` gates every store
 *     operation (`list`/`get`/`update`/`delete`/`create`), so throwing here would wedge the whole
 *     app — even deleting the bad workspace would fail — forcing users to hand-delete the persisted
 *     store to recover. Self-healing lets the app boot and recover in place.
 *   - The layout is the source of truth for corrupt input: panes are rebuilt 1:1 with the layout
 *     leaves. Orphan panes (referenced by no leaf) are dropped; duplicated leaves each get their own
 *     pane cloned from the referenced one; a leaf whose pane is missing entirely gets a fresh pane
 *     rooted at the workspace. This always yields validator-clean output regardless of how the data
 *     was corrupted. A healthy workspace keeps its pane order and identity untouched.
 */
function ensureGloballyUniquePaneIds(
  workspaces: Workspace[],
  createId: () => string,
  logger: Logger,
): Workspace[] {
  const seenPaneIds = new Set<string>();

  return workspaces.map((workspace) => {
    if (isWorkspaceInternallyConsistent(workspace)) {
      // Routine path: only reassign ids that collide with an earlier workspace, leaving pane order
      // and every non-colliding id untouched so this never disturbs an otherwise healthy workspace.
      const ownPaneIds = new Set(workspace.panes.map((pane) => pane.id));
      const remap = new Map<string, string>();
      for (const pane of workspace.panes) {
        if (!seenPaneIds.has(pane.id)) {
          seenPaneIds.add(pane.id);
          continue;
        }
        let nextId = createId();
        while (seenPaneIds.has(nextId) || ownPaneIds.has(nextId)) {
          nextId = createId();
        }
        seenPaneIds.add(nextId);
        remap.set(pane.id, nextId);
      }

      if (remap.size === 0) {
        return workspace;
      }

      return {
        ...workspace,
        panes: workspace.panes.map((pane) => {
          const nextId = remap.get(pane.id);
          return nextId ? { ...pane, id: nextId } : pane;
        }),
        tabs: workspace.tabs.map((tab) => ({
          ...tab,
          layout: mapLayoutPaneIds(tab.layout, (paneId) => remap.get(paneId) ?? paneId),
          activePaneId: tab.activePaneId
            ? (remap.get(tab.activePaneId) ?? tab.activePaneId)
            : tab.activePaneId,
        })),
      };
    }

    // Corrupt path: duplicate pane ids, orphan panes, or a pane referenced by multiple leaves. Treat
    // the layout as authoritative and rebuild the pane list to match it exactly, so the recovered
    // workspace is always validator-clean. See the function comment for why this self-heals.
    logger.warn(`Repairing workspace "${workspace.id}" with inconsistent pane ids or layout.`);
    const paneBySourceId = new Map<string, Pane>();
    for (const pane of workspace.panes) {
      if (!paneBySourceId.has(pane.id)) {
        paneBySourceId.set(pane.id, pane);
      }
    }

    const rebuiltPanes: Pane[] = [];
    const usedPaneIds = new Set<string>();
    const tabs = workspace.tabs.map((tab) => {
      const firstFinalIdBySourceId = new Map<string, string>();
      const layout = mapLayoutPaneIds(tab.layout, (sourceId) => {
        // Each leaf gets its own id, so duplicated leaves resolve to distinct panes.
        let finalId = sourceId;
        while (seenPaneIds.has(finalId) || usedPaneIds.has(finalId)) {
          finalId = createId();
        }
        usedPaneIds.add(finalId);
        seenPaneIds.add(finalId);
        if (!firstFinalIdBySourceId.has(sourceId)) {
          firstFinalIdBySourceId.set(sourceId, finalId);
        }
        const sourcePane = paneBySourceId.get(sourceId);
        rebuiltPanes.push(
          sourcePane ? { ...sourcePane, id: finalId } : { id: finalId, cwd: workspace.rootPath },
        );
        return finalId;
      });

      const activePaneId =
        tab.activePaneId && firstFinalIdBySourceId.has(tab.activePaneId)
          ? (firstFinalIdBySourceId.get(tab.activePaneId) ?? null)
          : (collectLayoutPaneIds(layout)[0] ?? null);
      return { ...tab, layout, activePaneId };
    });

    return { ...workspace, panes: rebuiltPanes, tabs };
  });
}

/**
 * Guarantees that every `tab.id` is unique across all persisted workspaces.
 *
 * The renderer mounts every tab of every workspace in a single list keyed by `tab.id` so that a tab
 * keeps its React identity — and therefore its live terminals — when it moves between workspaces
 * (see `MainTerminalArea`). Duplicate tab ids across workspaces would collide as React keys, so they
 * are reassigned here, mirroring the pane-id guarantee. Tab ids are not referenced by layouts, so
 * only the owning workspace's `activeTabId` needs rewriting alongside the id. The first occurrence
 * keeps its id; later collisions (cross-workspace, or a duplicate within one workspace) get a fresh
 * id.
 */
function ensureGloballyUniqueTabIds(workspaces: Workspace[], createId: () => string): Workspace[] {
  const seenTabIds = new Set<string>();

  return workspaces.map((workspace) => {
    // Assign ids per tab occurrence (not via an old-id keyed map) so that a tab id duplicated within
    // one workspace yields two distinct ids rather than collapsing both onto the same replacement.
    const usedInWorkspace = new Set<string>();
    const firstFinalIdByOriginalId = new Map<string, string>();
    let changed = false;

    const tabs = workspace.tabs.map((tab) => {
      let finalId = tab.id;
      while (seenTabIds.has(finalId) || usedInWorkspace.has(finalId)) {
        finalId = createId();
      }
      usedInWorkspace.add(finalId);
      seenTabIds.add(finalId);
      if (!firstFinalIdByOriginalId.has(tab.id)) {
        firstFinalIdByOriginalId.set(tab.id, finalId);
      }
      if (finalId === tab.id) {
        return tab;
      }
      changed = true;
      return { ...tab, id: finalId };
    });

    if (!changed) {
      return workspace;
    }

    // `activeTabId` is ambiguous if it pointed at a duplicated id; resolve it to the first occurrence.
    return {
      ...workspace,
      tabs,
      activeTabId: workspace.activeTabId
        ? (firstFinalIdByOriginalId.get(workspace.activeTabId) ?? workspace.activeTabId)
        : workspace.activeTabId,
    };
  });
}

/**
 * Persists workspace layouts and creates the initial single-workspace state for first launch.
 */
export class WorkspaceStore {
  private readonly createId: () => string;
  private readonly getHomeDirectory: () => string;
  private readonly getShellPath: () => string;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly storage: WorkspaceStorageAdapter;

  public constructor(options: WorkspaceStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.getHomeDirectory = options.getHomeDirectory ?? homedir;
    this.getShellPath = options.getShellPath ?? (() => process.env.SHELL ?? '/bin/zsh');
    this.logger = options.logger ?? createSilentLogger();
    this.now = options.now ?? Date.now;
    this.storage = options.storage ?? new ElectronWorkspaceStorageAdapter();
  }

  /**
   * Returns all persisted workspaces, creating the default workspace if storage is empty.
   */
  public list(): Workspace[] {
    return this.ensureWorkspaces();
  }

  /**
   * Returns the persisted active workspace id, or null when none has been saved.
   */
  public getActiveWorkspaceId(): string | null {
    return this.storage.getActiveWorkspaceId();
  }

  /**
   * Persists the active workspace id chosen by the renderer.
   */
  public setActiveWorkspaceId(id: string | null): void {
    this.storage.setActiveWorkspaceId(id);
  }

  /**
   * Returns one workspace by id, or null when no persisted workspace matches.
   */
  public get(id: string): Workspace | null {
    return this.ensureWorkspaces().find((workspace) => workspace.id === id) ?? null;
  }

  /**
   * Creates a workspace with one tab and one pane rooted at the supplied path.
   * Falls back to the home directory when rootPath is empty.
   */
  public create(name: string, rootPath: string): Workspace {
    const timestamp = this.now();
    const workspace = this.createWorkspace(name, rootPath || this.getHomeDirectory(), timestamp);
    const workspaces = this.normalizeWorkspacesForStorage([...this.ensureWorkspaces(), workspace]);
    this.storage.setWorkspaces(workspaces);
    return workspaces.find((currentWorkspace) => currentWorkspace.id === workspace.id) ?? workspace;
  }

  /**
   * Replaces a persisted workspace while preserving runtime-only pane state in memory only.
   */
  public update(workspace: Workspace): void {
    const timestamp = this.now();
    const updatedWorkspace = sanitizeWorkspace({
      ...workspace,
      updatedAt: timestamp,
    });
    const nextWorkspaces = this.ensureWorkspaces().map((currentWorkspace) =>
      currentWorkspace.id === updatedWorkspace.id ? updatedWorkspace : currentWorkspace,
    );

    if (!nextWorkspaces.some((currentWorkspace) => currentWorkspace.id === updatedWorkspace.id)) {
      nextWorkspaces.push(updatedWorkspace);
    }

    this.storage.setWorkspaces(this.normalizeWorkspacesForStorage(nextWorkspaces));
  }

  /**
   * Deletes a workspace while preserving the invariant that at least one workspace remains.
   */
  public delete(id: string): void {
    const currentWorkspaces = this.ensureWorkspaces();
    if (currentWorkspaces.length <= 1) {
      return;
    }

    const remainingWorkspaces = currentWorkspaces.filter((workspace) => workspace.id !== id);
    if (remainingWorkspaces.length === currentWorkspaces.length) {
      return;
    }

    const normalizedWorkspaces = this.normalizeWorkspacesForStorage(remainingWorkspaces);
    this.storage.setWorkspaces(normalizedWorkspaces);

    const activeWorkspaceId = this.storage.getActiveWorkspaceId();
    const activeWorkspaceExists = normalizedWorkspaces.some(
      (workspace) => workspace.id === activeWorkspaceId,
    );
    if (!activeWorkspaceExists) {
      this.storage.setActiveWorkspaceId(normalizedWorkspaces[0]?.id ?? null);
    }
  }

  private normalizeWorkspacesForStorage(
    workspaces: Array<Workspace | LegacyWorkspace>,
  ): Workspace[] {
    return ensureGloballyUniqueTabIds(
      ensureGloballyUniquePaneIds(workspaces.map(sanitizeWorkspace), this.createId, this.logger),
      this.createId,
    );
  }

  private ensureWorkspaces(): Workspace[] {
    const storedWorkspaces = this.storage.getWorkspaces() as Array<Workspace | LegacyWorkspace>;
    // Sanitize first (drop runtime-only fields / migrate legacy shapes), then guarantee globally
    // unique pane ids. Both are durable-model normalizations, so any change is written back here
    // and the renderer always receives data the terminal-runtime layer can key by `pane.id`.
    const workspaces = this.normalizeWorkspacesForStorage(storedWorkspaces);

    if (workspaces.length > 0) {
      if (JSON.stringify(storedWorkspaces) !== JSON.stringify(workspaces)) {
        this.storage.setWorkspaces(workspaces);
      }
      return workspaces;
    }

    const defaultWorkspace = this.createDefaultWorkspace();
    this.storage.setWorkspaces([sanitizeWorkspace(defaultWorkspace)]);
    return [defaultWorkspace];
  }

  private createDefaultWorkspace(): Workspace {
    return this.createWorkspace('Default', this.getHomeDirectory(), this.now());
  }

  private createWorkspace(name: string, rootPath: string, timestamp: number): Workspace {
    const workspaceId = this.createId();
    const tabId = this.createId();
    const paneId = this.createId();
    const tabName = path.basename(this.getShellPath() || '/bin/zsh');

    return {
      id: workspaceId,
      name,
      rootPath,
      tabs: [
        {
          id: tabId,
          name: tabName,
          layout: {
            type: 'leaf',
            paneId,
          },
          activePaneId: paneId,
        },
      ],
      panes: [
        {
          id: paneId,
          cwd: rootPath,
        },
      ],
      activeTabId: tabId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
