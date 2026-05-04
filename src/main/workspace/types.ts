import type { Workspace } from '../../shared/types';

export interface WorkspaceStorageAdapter {
  getWorkspaces: () => Workspace[];
  setWorkspaces: (workspaces: Workspace[]) => void;
  getActiveWorkspaceId: () => string | null;
  setActiveWorkspaceId: (id: string | null) => void;
}

export interface WorkspaceStoreOptions {
  createId?: () => string;
  getHomeDirectory?: () => string;
  getShellPath?: () => string;
  now?: () => number;
  storage?: WorkspaceStorageAdapter;
}
