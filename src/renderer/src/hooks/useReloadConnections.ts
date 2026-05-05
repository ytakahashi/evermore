import { useCallback } from 'react';
import { useConnectionsStore } from '../stores/connectionsStore';
import { useTunnelsStore } from '../stores/tunnelsStore';

export interface ReloadConnectionsState {
  isReloading: boolean;
  reloadConnections: () => Promise<void>;
}

/**
 * Reloads SSH config first, then refreshes tunnel entries from the updated config snapshot.
 */
export function useReloadConnections(): ReloadConnectionsState {
  const isHostsLoading = useConnectionsStore((state) => state.isLoading);
  const isTunnelsLoading = useTunnelsStore((state) => state.isLoading);

  const reloadConnections = useCallback(async (): Promise<void> => {
    await useConnectionsStore.getState().reloadHosts();
    if (useConnectionsStore.getState().error === null) {
      await useTunnelsStore.getState().loadTunnels();
    }
  }, []);

  return {
    isReloading: isHostsLoading || isTunnelsLoading,
    reloadConnections,
  };
}
