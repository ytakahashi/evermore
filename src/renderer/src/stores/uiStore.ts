import { create } from 'zustand';

export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export type SidebarView = 'workspaces' | 'connections';

/**
 * What is rendered in the main pane area.
 *
 * `'workspace'` keeps the existing terminal grid visible; `'settings'` reveals the SettingsView
 * while keeping the workspace tree mounted (display:none) so PTY processes survive the round-trip.
 */
export type ActiveView = 'workspace' | 'settings';

interface UiStoreState {
  windowFullScreen: boolean;
  fullscreenPaneId: string | null;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number; // px, always within [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
  activeView: ActiveView;
  tabBarOpen: boolean;
  clearFullscreen: () => void;
  setFullscreenPaneId: (paneId: string | null) => void;
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setActiveView: (view: ActiveView) => void;
  setTabBarOpen: (open: boolean) => void;
  toggleTabBar: () => void;
  setWindowFullScreen: (isFullScreen: boolean) => void;
  /** Switches the main pane to the SettingsView. Idempotent; no-op when already active. */
  openSettings: () => void;
  /** Returns the main pane to the workspace view. Idempotent; no-op when already active. */
  closeSettings: () => void;
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
  clearFullscreen: () => {
    set({ fullscreenPaneId: null });
  },
  setFullscreenPaneId: (paneId) => {
    set({ fullscreenPaneId: paneId });
  },
  setSidebarView: (view) => {
    // Workspaces / Connections are "main-area context" controls; clicking either while the
    // SettingsView is up should bring the user back to the workspace pane so the click feels like
    // it actually changed what they see. Settings stays reachable via the gear button or Cmd+,.
    set((state) => ({
      sidebarView: view,
      activeView: state.activeView === 'settings' ? 'workspace' : state.activeView,
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
  setWindowFullScreen: (isFullScreen) => {
    set({ windowFullScreen: isFullScreen });
  },
  openSettings: () => {
    if (get().activeView !== 'settings') {
      set({ activeView: 'settings' });
    }
  },
  closeSettings: () => {
    if (get().activeView !== 'workspace') {
      set({ activeView: 'workspace' });
    }
  },
}));
