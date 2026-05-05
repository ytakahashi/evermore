export interface Workspace {
  id: string;
  name: string;
  rootPath: string; // workspace root directory (absolute path)
  tabs: Tab[];
  panes: Pane[];
  activeTabId: string | null;
  createdAt: number; // unix ms
  updatedAt: number;
}

export interface Tab {
  id: string;
  title: string;
  layout: PaneLayout;
  activePaneId: string | null;
}

export type PaneLayout =
  | { type: 'leaf'; paneId: string }
  | {
      type: 'split';
      direction: 'horizontal' | 'vertical';
      ratio: number;
      children: [PaneLayout, PaneLayout];
    };

export interface Pane {
  id: string;
  cwd: string; // absolute path
  title: string; // display name
  ptyId?: string; // runtime only
}

export interface SSHHost {
  alias: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  hasForwarding: boolean;
  forwards: ForwardEntry[];
}

export interface Tunnel {
  alias: string;
  forwards: ForwardEntry[];
  status: TunnelStatus;
  pid?: number;
  startedAt?: number;
  lastError?: string;
  recentLogs: string[];
}

export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface ForwardEntry {
  type: 'local' | 'remote' | 'dynamic';
  bindAddress?: string;
  bindPort: number;
  hostAddress?: string;
  hostPort?: number;
}

export interface AppSettings {
  ui: {
    sidebarOpen: boolean;
    sidebarWidth: number;
    sidebarView: 'workspaces' | 'connections';
  };
  ssh: {
    pinnedHosts: string[];
    hiddenHosts: string[];
    favoriteTunnels: string[];
    autoStartTunnels: string[];
  };
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorStyle: 'block' | 'bar' | 'underline';
  };
}
