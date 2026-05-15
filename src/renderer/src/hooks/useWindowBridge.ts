import { useEffect } from 'react';
import { useUiStore } from '../stores/uiStore';

/**
 * Synchronizes window-level state (like fullscreen) from the main process to the UI store.
 */
export function useWindowBridge(): void {
  const setWindowFullScreen = useUiStore((state) => state.setWindowFullScreen);

  useEffect(() => {
    // Initial state
    void window.api.window.isFullScreen().then((isFullScreen) => {
      setWindowFullScreen(isFullScreen);
    });

    // Listen for changes
    const removeListener = window.api.window.onFullScreenChanged((isFullScreen) => {
      setWindowFullScreen(isFullScreen);
    });

    return () => {
      removeListener();
    };
  }, [setWindowFullScreen]);
}
