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

/** Settings navigation identifiers shared by the shell and settings view. */
export type SettingsSectionId =
  | 'terminal'
  | 'paneInfo'
  | 'shortcuts'
  | 'application'
  | 'projects'
  | 'agentPresets'
  | 'recommendedSetup'
  | 'aiIntegration'
  | 'notifications'
  | 'advancedFeatures'
  | 'about';

export interface UiStoreState {
  windowFullScreen: boolean;
  fullscreenPaneId: string | null;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  sidebarWidth: number; // px, always within [SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH]
  activeView: ActiveView;
  tabBarOpen: boolean;
  tabSearchOpen: boolean;
  projectPaletteOpen: boolean;
  projectPaletteFocusRequest: number;
  launchPaletteOpen: boolean;
  launchPaletteFocusRequest: number;
  lastAgentPresetId: string | null;
  pendingAgentSelectionPaneId: string | null;
  openLaunchPalette: () => void;
  closeLaunchPalette: () => void;
  /** Records a successful launch for the next preset selection. */
  rememberAgentPreset: (id: string) => void;
  /** Requests selection once the launched pane has a PTY. */
  requestAgentSelection: (paneId: string) => void;
  /** Consumes only the matching request so a newer launch cannot be cleared by stale work. */
  consumeAgentSelection: (paneId: string) => void;
  settingsSection: SettingsSectionId;
  terminalFocusRequest: number;
  openProjectPalette: () => void;
  closeProjectPalette: () => void;
  focusWorkspace: () => void;
  setSettingsSection: (section: SettingsSectionId) => void;
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
  /** Opens Settings, retaining its last section unless an explicit destination is supplied. */
  openSettings: (section?: SettingsSectionId) => void;
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
/**
 * Returns whether a modal picker owns keyboard input. Every new picker must be added here so
 * workspace commands and delayed terminal focus stay suspended behind it.
 */
export function selectIsPaletteOpen(
  state: Pick<UiStoreState, 'projectPaletteOpen' | 'tabSearchOpen' | 'launchPaletteOpen'>,
): boolean {
  return state.projectPaletteOpen || state.tabSearchOpen || state.launchPaletteOpen;
}

/** Returns whether the workspace is visible and not covered by a modal picker. */
export function selectIsWorkspaceInteractive(
  state: Pick<
    UiStoreState,
    'activeView' | 'projectPaletteOpen' | 'tabSearchOpen' | 'launchPaletteOpen'
  >,
): boolean {
  return state.activeView === 'workspace' && !selectIsPaletteOpen(state);
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  windowFullScreen: false,
  fullscreenPaneId: null,
  sidebarView: 'workspaces',
  sidebarOpen: true,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  activeView: 'workspace',
  tabBarOpen: false,
  tabSearchOpen: false,
  projectPaletteOpen: false,
  projectPaletteFocusRequest: 0,
  launchPaletteOpen: false,
  launchPaletteFocusRequest: 0,
  lastAgentPresetId: null,
  pendingAgentSelectionPaneId: null,
  openLaunchPalette: () =>
    set((state) => ({
      launchPaletteOpen: true,
      projectPaletteOpen: false,
      tabSearchOpen: false,
      launchPaletteFocusRequest: state.launchPaletteFocusRequest + 1,
    })),
  closeLaunchPalette: () => set({ launchPaletteOpen: false }),
  rememberAgentPreset: (id) => set({ lastAgentPresetId: id }),
  requestAgentSelection: (paneId) => {
    if (get().activeView === 'agents') set({ pendingAgentSelectionPaneId: paneId });
  },
  consumeAgentSelection: (paneId) => {
    if (get().pendingAgentSelectionPaneId === paneId) set({ pendingAgentSelectionPaneId: null });
  },
  settingsSection: 'terminal',
  terminalFocusRequest: 0,
  openProjectPalette: () =>
    set((state) => ({
      projectPaletteOpen: true,
      launchPaletteOpen: false,
      tabSearchOpen: false,
      projectPaletteFocusRequest: state.projectPaletteFocusRequest + 1,
    })),
  closeProjectPalette: () => set({ projectPaletteOpen: false }),
  focusWorkspace: () =>
    set((state) => ({
      activeView: 'workspace',
      pendingAgentSelectionPaneId: null,
      terminalFocusRequest: state.terminalFocusRequest + 1,
    })),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
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
      pendingAgentSelectionPaneId: null,
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
    set({ activeView: view, ...(view === 'agents' ? {} : { pendingAgentSelectionPaneId: null }) });
  },
  setTabBarOpen: (open) => {
    set({ tabBarOpen: open });
  },
  toggleTabBar: () => {
    set((state) => ({ tabBarOpen: !state.tabBarOpen }));
  },
  openTabSearch: () => {
    set({ tabSearchOpen: true, projectPaletteOpen: false, launchPaletteOpen: false });
  },
  closeTabSearch: () => {
    set({ tabSearchOpen: false });
  },
  setWindowFullScreen: (isFullScreen) => {
    set({ windowFullScreen: isFullScreen });
  },
  openSettings: (section) => {
    set({
      activeView: 'settings',
      pendingAgentSelectionPaneId: null,
      settingsSection: section ?? get().settingsSection,
    });
  },
  openAgents: () => {
    if (get().activeView !== 'agents') {
      set({ activeView: 'agents' });
    }
  },
  showWorkspaceView: () => {
    if (get().activeView !== 'workspace') {
      set({ activeView: 'workspace', pendingAgentSelectionPaneId: null });
    }
  },
}));
