import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import Store from 'electron-store';
import type { Pane, Workspace } from '../../shared/types';
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

function sanitizePane(pane: Pane): Pane {
  const { ptyId: _ptyId, ...persistedPane } = pane;
  return persistedPane;
}

function sanitizeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    panes: workspace.panes.map(sanitizePane),
  };
}

/**
 * Persists workspace layouts and creates the initial single-workspace state for first launch.
 */
export class WorkspaceStore {
  private readonly createId: () => string;
  private readonly getHomeDirectory: () => string;
  private readonly getShellPath: () => string;
  private readonly now: () => number;
  private readonly storage: WorkspaceStorageAdapter;

  public constructor(options: WorkspaceStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.getHomeDirectory = options.getHomeDirectory ?? homedir;
    this.getShellPath = options.getShellPath ?? (() => process.env.SHELL ?? '/bin/zsh');
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
    const workspaces = [...this.ensureWorkspaces(), workspace];
    this.storage.setWorkspaces(workspaces.map(sanitizeWorkspace));
    return workspace;
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
    const workspaces = this.ensureWorkspaces().map((currentWorkspace) =>
      currentWorkspace.id === updatedWorkspace.id ? updatedWorkspace : currentWorkspace,
    );

    if (!workspaces.some((currentWorkspace) => currentWorkspace.id === updatedWorkspace.id)) {
      workspaces.push(updatedWorkspace);
    }

    this.storage.setWorkspaces(workspaces);
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

    const sanitizedWorkspaces = remainingWorkspaces.map(sanitizeWorkspace);
    this.storage.setWorkspaces(sanitizedWorkspaces);

    const activeWorkspaceId = this.storage.getActiveWorkspaceId();
    const activeWorkspaceExists = sanitizedWorkspaces.some(
      (workspace) => workspace.id === activeWorkspaceId,
    );
    if (!activeWorkspaceExists) {
      this.storage.setActiveWorkspaceId(sanitizedWorkspaces[0]?.id ?? null);
    }
  }

  private ensureWorkspaces(): Workspace[] {
    const workspaces = this.storage.getWorkspaces().map(sanitizeWorkspace);

    if (workspaces.length > 0) {
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
    const title = path.basename(this.getShellPath() || '/bin/zsh');

    return {
      id: workspaceId,
      name,
      rootPath,
      tabs: [
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
        {
          id: paneId,
          cwd: rootPath,
          title,
        },
      ],
      activeTabId: tabId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
