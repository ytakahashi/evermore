import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Api } from '../../../shared/api-types';

type SshApi = Pick<Api['ssh'], 'resolve'>;

interface CreateSshResolutionsStoreOptions {
  sshApi?: SshApi;
}

/**
 * Represents the state of a single SSH alias resolution. Aliases that have
 * never been requested have no entry in the resolutions map at all.
 */
export type ResolutionStatus = 'loading' | 'ready' | 'error';

/**
 * Data associated with an SSH alias resolution.
 */
export interface ResolutionEntry {
  status: ResolutionStatus;
  data?: Record<string, string[]>;
  error?: string;
}

/**
 * State and actions for the SSH resolutions store.
 */
export interface SshResolutionsStoreState {
  /** Map of alias to its resolution state. */
  resolutions: Record<string, ResolutionEntry>;
  /** Fetches resolved configuration for an alias if not already loading/ready. */
  resolveAlias: (alias: string) => Promise<void>;
  /** Clears all cached resolutions. */
  clear: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  // avoid displaying unhelpful "[object Object]" when the error is an object without a message property
  return 'Unknown error';
}

/**
 * Creates the SSH resolutions store.
 * This store handles on-demand resolution of SSH aliases using `ssh -G`.
 */
export function createSshResolutionsStore(
  options: CreateSshResolutionsStoreOptions = {},
): UseBoundStore<StoreApi<SshResolutionsStoreState>> {
  const getSshApi = (): SshApi => options.sshApi ?? window.api.ssh;
  let generation = 0;

  return create<SshResolutionsStoreState>((set, get) => ({
    resolutions: {},

    resolveAlias: async (alias: string): Promise<void> => {
      const current = get().resolutions[alias];
      if (current?.status === 'loading' || current?.status === 'ready') {
        return;
      }

      set((state) => ({
        resolutions: {
          ...state.resolutions,
          [alias]: { status: 'loading' },
        },
      }));

      const generationAtStart = generation;

      try {
        const data = await getSshApi().resolve(alias);
        if (generationAtStart !== generation) {
          return;
        }
        set((state) => ({
          resolutions: {
            ...state.resolutions,
            [alias]: { status: 'ready', data },
          },
        }));
      } catch (error: unknown) {
        if (generationAtStart !== generation) {
          return;
        }
        set((state) => ({
          resolutions: {
            ...state.resolutions,
            [alias]: { status: 'error', error: getErrorMessage(error) },
          },
        }));
      }
    },

    clear: (): void => {
      generation += 1;
      set({ resolutions: {} });
    },
  }));
}

/**
 * App-wide singleton SSH resolutions store.
 *
 * **Tests must use {@link createSshResolutionsStore} to construct an isolated store per test**
 * rather than reusing this singleton. See `workspaceStore.useWorkspaceStore` for the broader
 * rationale.
 */
export const useSshResolutionsStore = createSshResolutionsStore();
