import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Api } from '../../../shared/api-types';
import { TUNNEL_LOG_BUFFER_SIZE } from '../../../shared/tunnel-constants';
import type { Tunnel, TunnelStatus } from '../../../shared/types';

type TunnelApi = Pick<Api['tunnel'], 'list' | 'start' | 'stop'>;

interface CreateTunnelsStoreOptions {
  logBufferSize?: number;
  now?: () => number;
  tunnelApi?: TunnelApi;
}

export interface TunnelsStoreState {
  tunnels: Tunnel[];
  isLoading: boolean;
  error: string | null;
  loadTunnels: () => Promise<void>;
  startTunnel: (alias: string) => Promise<void>;
  stopTunnel: (alias: string) => Promise<void>;
  setStatus: (alias: string, status: TunnelStatus, error?: string) => void;
  appendLog: (alias: string, line: string) => void;
}

/**
 * Counts tunnels that have reached the running state.
 */
export function selectRunningTunnelCount(state: TunnelsStoreState): number {
  return state.tunnels.filter((tunnel) => tunnel.status === 'running').length;
}

/**
 * Counts tunnels currently reporting an error state.
 */
export function selectErrorTunnelCount(state: TunnelsStoreState): number {
  return state.tunnels.filter((tunnel) => tunnel.status === 'error').length;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  // Avoid surfacing "[object Object]" in the sidebar for non-Error rejections.
  return 'Unknown error';
}

/**
 * Creates the transient renderer store for SSH tunnel runtime state.
 */
export function createTunnelsStore(
  options: CreateTunnelsStoreOptions = {},
): UseBoundStore<StoreApi<TunnelsStoreState>> {
  const logBufferSize = options.logBufferSize ?? TUNNEL_LOG_BUFFER_SIZE;
  const now = options.now ?? Date.now;
  const getTunnelApi = (): TunnelApi => options.tunnelApi ?? window.api.tunnel;

  return create<TunnelsStoreState>((set) => ({
    tunnels: [],
    isLoading: false,
    error: null,
    loadTunnels: async (): Promise<void> => {
      set({ isLoading: true, error: null });

      try {
        const tunnels = await getTunnelApi().list();
        set({ tunnels, isLoading: false, error: null });
      } catch (error: unknown) {
        // Preserve the last successful snapshot so the UI can keep showing usable tunnel controls.
        set({ isLoading: false, error: getErrorMessage(error) });
      }
    },
    startTunnel: async (alias: string): Promise<void> => {
      try {
        set({ error: null });
        await getTunnelApi().start(alias);
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
      }
    },
    stopTunnel: async (alias: string): Promise<void> => {
      try {
        set({ error: null });
        await getTunnelApi().stop(alias);
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
      }
    },
    setStatus: (alias: string, status: TunnelStatus, error?: string): void => {
      set((state) => ({
        tunnels: state.tunnels.map((tunnel) => {
          if (tunnel.alias !== alias) {
            return tunnel;
          }

          return {
            ...tunnel,
            status,
            startedAt:
              status === 'running' ? now() : status === 'stopped' ? undefined : tunnel.startedAt,
            lastError: error !== undefined ? error : tunnel.lastError,
          };
        }),
      }));
    },
    appendLog: (alias: string, line: string): void => {
      set((state) => ({
        tunnels: state.tunnels.map((tunnel) => {
          if (tunnel.alias !== alias) {
            return tunnel;
          }

          const recentLogs = [...tunnel.recentLogs, line];
          return {
            ...tunnel,
            recentLogs:
              recentLogs.length > logBufferSize
                ? recentLogs.slice(recentLogs.length - logBufferSize)
                : recentLogs,
          };
        }),
      }));
    },
  }));
}

/**
 * App-wide singleton tunnels store.
 *
 * **Tests must use {@link createTunnelsStore} to construct an isolated store per test** rather
 * than reusing this singleton (state bleeds across parallel tests and stale subscriptions can
 * outlive a test). See `workspaceStore.useWorkspaceStore` for the broader rationale.
 */
export const useTunnelsStore = createTunnelsStore();
