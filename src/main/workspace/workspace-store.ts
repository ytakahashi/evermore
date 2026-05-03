import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import Store from 'electron-store';
import type { Pane, Workspace } from '../../shared/types';
import type { WorkspaceStorageAdapter, WorkspaceStoreOptions } from './types';

interface WorkspaceStoreSchema extends Record<string, unknown> {
  workspaces: Workspace[];
}

class ElectronWorkspaceStorageAdapter implements WorkspaceStorageAdapter {
  private readonly store: Store<WorkspaceStoreSchema>;

  public constructor() {
    this.store = new Store<WorkspaceStoreSchema>({
      name: 'workspaces',
      defaults: {
        workspaces: [],
      },
    });
  }

  public getWorkspaces(): Workspace[] {
    return this.store.get('workspaces');
  }

  public setWorkspaces(workspaces: Workspace[]): void {
    this.store.set('workspaces', workspaces);
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
  private readonly now: () => number;
  private readonly storage: WorkspaceStorageAdapter;

  public constructor(options: WorkspaceStoreOptions = {}) {
    this.createId = options.createId ?? randomUUID;
    this.getHomeDirectory = options.getHomeDirectory ?? homedir;
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
   * Returns one workspace by id, or null when no persisted workspace matches.
   */
  public get(id: string): Workspace | null {
    return this.ensureWorkspaces().find((workspace) => workspace.id === id) ?? null;
  }

  /**
   * Creates a workspace with one tab and one pane rooted at the supplied path.
   */
  public create(name: string, rootPath: string): Workspace {
    const timestamp = this.now();
    const workspace = this.createWorkspace(name, rootPath, timestamp);
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

    this.storage.setWorkspaces(workspaces.map(sanitizeWorkspace));
  }

  /**
   * Deletes a workspace and regenerates the default workspace when the last one is removed.
   */
  public delete(id: string): void {
    const remainingWorkspaces = this.ensureWorkspaces().filter((workspace) => workspace.id !== id);
    this.storage.setWorkspaces(
      (remainingWorkspaces.length > 0 ? remainingWorkspaces : [this.createDefaultWorkspace()]).map(
        sanitizeWorkspace,
      ),
    );
  }

  private ensureWorkspaces(): Workspace[] {
    const workspaces = this.storage.getWorkspaces().map(sanitizeWorkspace);

    if (workspaces.length > 0) {
      this.storage.setWorkspaces(workspaces);
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

    return {
      id: workspaceId,
      name,
      rootPath,
      tabs: [
        {
          id: tabId,
          title: 'zsh',
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
          title: 'zsh',
        },
      ],
      activeTabId: tabId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
