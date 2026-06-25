import type { Workspace } from '../../shared/types';
import type { Logger } from '../logging/logger';

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
  logger?: Logger;
  now?: () => number;
  storage?: WorkspaceStorageAdapter;
}
