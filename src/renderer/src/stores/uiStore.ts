import { create } from 'zustand';

export type SidebarView = 'workspaces' | 'connections';

interface UiStoreState {
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
}

/**
 * Stores transient renderer-only UI state that will be persisted through settings in Phase 4.
 */
export const useUiStore = create<UiStoreState>((set) => ({
  sidebarView: 'workspaces',
  setSidebarView: (view) => {
    set({ sidebarView: view });
  },
}));
