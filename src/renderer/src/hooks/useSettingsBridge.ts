import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Loads persisted settings from the main process once on app mount.
 *
 * Mirrors `usePaneInfoBridge` / `useTunnelEventBridge`: a top-level App-mounted hook that owns the
 * one-time bootstrap so individual feature components do not need to coordinate the load.
 */
export function useSettingsBridge(): void {
  const loadSettings = useSettingsStore((state) => state.loadSettings);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);
}
