import { create } from 'zustand';

export const SIDEBAR_DEFAULT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;

export type SidebarView = 'workspaces' | 'connections';

interface UiStoreState {
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number; // px, always within [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

/**
 * Stores transient renderer-only UI state (sidebar view, sidebar open/close, sidebar width).
 * The sidebar open/close state and width are not persisted and reset to defaults on app launch.
 */
export const useUiStore = create<UiStoreState>((set) => ({
  sidebarView: 'workspaces',
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  setSidebarView: (view) => {
    set({ sidebarView: view });
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
}));
