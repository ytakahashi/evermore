import { create } from 'zustand';

/** Identifies the tab currently being dragged and the workspace it started in. */
export interface TabDragDescriptor {
  sourceWorkspaceId: string;
  tabId: string;
}

interface TabDragStoreState {
  /** The in-flight tab drag, or null when nothing is being dragged. */
  dragging: TabDragDescriptor | null;
  begin: (descriptor: TabDragDescriptor) => void;
  end: () => void;
}

/**
 * Holds the source of an in-flight tab drag. Native HTML5 DnD blocks reading `dataTransfer` data
 * during `dragover`, so the drag-and-drop handlers in TabBar / WorkspacesView read the source ids
 * from here instead while a drag is hovering (see `TAB_DND_MIME` in `components/common/tabDnd`).
 * Renderer-only transient state; never persisted.
 */
export const useTabDragStore = create<TabDragStoreState>((set) => ({
  dragging: null,
  begin: (descriptor) => {
    set({ dragging: descriptor });
  },
  end: () => {
    set({ dragging: null });
  },
}));
