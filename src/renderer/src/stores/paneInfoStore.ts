import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { PaneRuntimeInfo } from '../../../shared/types';

type PaneInfoApi = Pick<Window['api']['paneInfo'], 'list'>;

interface CreatePaneInfoStoreOptions {
  paneInfoApi?: PaneInfoApi;
}

export interface PaneInfoStoreState {
  infosByPtyId: Record<string, PaneRuntimeInfo>;
  isLoading: boolean;
  error: string | null;
  loadPaneInfo: () => Promise<void>;
  setInfo: (info: PaneRuntimeInfo) => void;
  removeInfo: (ptyId: string) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

/**
 * Creates the transient renderer store for PTY-backed pane runtime information.
 */
export function createPaneInfoStore(
  options: CreatePaneInfoStoreOptions = {},
): UseBoundStore<StoreApi<PaneInfoStoreState>> {
  const getPaneInfoApi = (): PaneInfoApi => options.paneInfoApi ?? window.api.paneInfo;

  return create<PaneInfoStoreState>((set) => ({
    infosByPtyId: {},
    isLoading: false,
    error: null,
    loadPaneInfo: async (): Promise<void> => {
      set({ isLoading: true, error: null });

      try {
        const infos = await getPaneInfoApi().list();
        set({
          infosByPtyId: Object.fromEntries(infos.map((info) => [info.ptyId, info])),
          isLoading: false,
          error: null,
        });
      } catch (error: unknown) {
        // Preserve the last successful snapshot so the sidebar keeps showing useful state.
        set({ isLoading: false, error: getErrorMessage(error) });
      }
    },
    setInfo: (info: PaneRuntimeInfo): void => {
      set((state) => ({
        infosByPtyId: {
          ...state.infosByPtyId,
          [info.ptyId]: info,
        },
      }));
    },
    removeInfo: (ptyId: string): void => {
      set((state) => {
        const { [ptyId]: _removed, ...infosByPtyId } = state.infosByPtyId;
        return { infosByPtyId };
      });
    },
  }));
}

export const usePaneInfoStore = createPaneInfoStore();
