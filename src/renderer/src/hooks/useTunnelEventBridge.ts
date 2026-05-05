import { useEffect, useRef } from 'react';
import { useTunnelsStore } from '../stores/tunnelsStore';

/**
 * Subscribes once to main-process tunnel runtime events and mirrors them into renderer state.
 */
export function useTunnelEventBridge(): void {
  const didLoadRef = useRef(false);

  useEffect(() => {
    const unsubscribeStatus = window.api.tunnel.onStatusChanged((alias, status, error) => {
      useTunnelsStore.getState().setStatus(alias, status, error);
    });
    const unsubscribeLog = window.api.tunnel.onLog((alias, line) => {
      useTunnelsStore.getState().appendLog(alias, line);
    });

    if (!didLoadRef.current) {
      didLoadRef.current = true;
      void useTunnelsStore.getState().loadTunnels();
    }

    return (): void => {
      unsubscribeStatus();
      unsubscribeLog();
    };
  }, []);
}
