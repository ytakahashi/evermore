import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Api } from '../../../shared/api-types';
import type { SSHHost } from '../../../shared/types';

type SshApi = Pick<Api['ssh'], 'listHosts' | 'reloadHosts'>;

interface CreateConnectionsStoreOptions {
  sshApi?: SshApi;
}

export interface ConnectionsStoreState {
  hosts: SSHHost[];
  isLoading: boolean;
  error: string | null;
  loadHosts: () => Promise<void>;
  reloadHosts: () => Promise<void>;
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
 * Creates the transient SSH connections store. SSH config remains read-only and is reloaded from
 * `~/.ssh/config`; no host list is persisted in renderer state.
 */
export function createConnectionsStore(
  options: CreateConnectionsStoreOptions = {},
): UseBoundStore<StoreApi<ConnectionsStoreState>> {
  const getSshApi = (): SshApi => options.sshApi ?? window.api.ssh;

  const runHostRequest = async (
    set: StoreApi<ConnectionsStoreState>['setState'],
    request: () => Promise<SSHHost[]>,
  ): Promise<void> => {
    set({ isLoading: true, error: null });

    try {
      const hosts = await request();
      set({ hosts, isLoading: false, error: null });
    } catch (error: unknown) {
      // Keep the last successfully loaded hosts visible; a transient reload failure should not
      // clear usable connection shortcuts that came from the previous config parse.
      set({ isLoading: false, error: getErrorMessage(error) });
    }
  };

  return create<ConnectionsStoreState>((set) => ({
    hosts: [],
    isLoading: false,
    error: null,
    loadHosts: async (): Promise<void> => {
      await runHostRequest(set, () => getSshApi().listHosts());
    },
    reloadHosts: async (): Promise<void> => {
      await runHostRequest(set, () => getSshApi().reloadHosts());
    },
  }));
}

/**
 * App-wide singleton connections store.
 *
 * **Tests must use {@link createConnectionsStore} to construct an isolated store per test** rather
 * than reusing this singleton (state bleeds across parallel tests and stale subscriptions can
 * outlive a test). See `workspaceStore.useWorkspaceStore` for the broader rationale.
 */
export const useConnectionsStore = createConnectionsStore();
