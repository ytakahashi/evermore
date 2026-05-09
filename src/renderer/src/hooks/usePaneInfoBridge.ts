import { useEffect, useRef } from 'react';
import { usePaneInfoStore } from '../stores/paneInfoStore';

/**
 * Subscribes once to main-process pane runtime events and mirrors them into renderer state.
 */
export function usePaneInfoBridge(): void {
  const didLoadRef = useRef(false);

  useEffect(() => {
    const unsubscribeChanged = window.api.paneInfo.onChanged((info) => {
      usePaneInfoStore.getState().setInfo(info);
    });

    if (!didLoadRef.current) {
      didLoadRef.current = true;
      void usePaneInfoStore.getState().loadPaneInfo();
    }

    return (): void => {
      unsubscribeChanged();
    };
  }, []);
}
