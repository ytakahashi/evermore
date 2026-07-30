import { create } from 'zustand';

export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export type SidebarView = 'workspaces' | 'connections';

/**
 * What is rendered in the main pane area.
 *
 * `'workspace'` keeps the existing terminal grid visible; `'settings'` and `'agents'` reveal their
 * own view while keeping the workspace tree mounted (display:none) so PTY processes survive the
 * round-trip.
 */
export type ActiveView = 'workspace' | 'settings' | 'agents';

interface UiStoreState {
  windowFullScreen: boolean;
  fullscreenPaneId: string | null;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number; // px, always within [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
  activeView: ActiveView;
  tabBarOpen: boolean;
  tabSearchOpen: boolean;
  clearFullscreen: () => void;
  setFullscreenPaneId: (paneId: string | null) => void;
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveView: (view: ActiveView) => void;
  setTabBarOpen: (open: boolean) => void;
  toggleTabBar: () => void;
  openTabSearch: () => void;
  closeTabSearch: () => void;
  setWindowFullScreen: (isFullScreen: boolean) => void;
  /** Switches the main pane to the SettingsView. Idempotent; no-op when already active. */
  openSettings: () => void;
  /** Switches the main pane to the AgentsView. Idempotent; no-op when already active. */
  openAgents: () => void;
  /** Returns the main pane to the workspace view. Idempotent; no-op when already active. */
  showWorkspaceView: () => void;
}

/**
 * Stores transient renderer-only UI state (sidebar view, sidebar open/close, sidebar width,
 * active main-area view). Nothing in this store is persisted to disk: persisted preferences live
 * in `useSettingsStore` and are written through the main-process settings file.
 */
export const useUiStore = create<UiStoreState>((set, get) => ({
  windowFullScreen: false,
  fullscreenPaneId: null,
  sidebarView: 'workspaces',
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  activeView: 'workspace',
  tabBarOpen: false,
  tabSearchOpen: false,
  clearFullscreen: () => {
    set({ fullscreenPaneId: null });
  },
  setFullscreenPaneId: (paneId) => {
    set({ fullscreenPaneId: paneId });
  },
  setSidebarView: (view) => {
    // Workspaces / Connections are "main-area context" controls; clicking either while some other
    // view occupies the main pane should bring the user back to the workspace pane so the click
    // feels like it actually changed what they see. The condition is written against 'workspace'
    // rather than listing the other views, so a view added later cannot silently become one the
    // sidebar refuses to leave. Settings and Agents stay reachable via their own nav buttons and
    // shortcuts.
    set((state) => ({
      sidebarView: view,
      activeView: state.activeView === 'workspace' ? state.activeView : 'workspace',
    }));
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
  },
  setSidebarWidth: (width) => {
    set(() => {
      if (!Number.isFinite(width)) {
        return { sidebarWidth: SIDEBAR_DEFAULT_WIDTH };
      }
      return {
        sidebarWidth: Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH),
      };
    });
  },
  setActiveView: (view) => {
    set({ activeView: view });
  },
  setTabBarOpen: (open) => {
    set({ tabBarOpen: open });
  },
  toggleTabBar: () => {
    set((state) => ({ tabBarOpen: !state.tabBarOpen }));
  },
  openTabSearch: () => {
    set({ tabSearchOpen: true });
  },
  closeTabSearch: () => {
    set({ tabSearchOpen: false });
  },
  setWindowFullScreen: (isFullScreen) => {
    set({ windowFullScreen: isFullScreen });
  },
  openSettings: () => {
    if (get().activeView !== 'settings') {
      set({ activeView: 'settings' });
    }
  },
  openAgents: () => {
    if (get().activeView !== 'agents') {
      set({ activeView: 'agents' });
    }
  },
  showWorkspaceView: () => {
    if (get().activeView !== 'workspace') {
      set({ activeView: 'workspace' });
    }
  },
}));
