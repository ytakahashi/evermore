import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Api, SettingsUpdate } from '../../../shared/api-types';
import type { AppSettings } from '../../../shared/types';

type SettingsApi = Api['settings'];

const DEFAULT_DEBOUNCE_MS = 300;

interface CreateSettingsStoreOptions {
  debounceMs?: number;
  settingsApi?: SettingsApi;
}

export interface SettingsStoreState {
  /**
   * The latest known settings from the main process. `null` until {@link loadSettings} succeeds.
   *
   * Components that need the settings during the brief load window should treat `null` as
   * "loading" and read defaults locally; the store deliberately does not pre-populate with
   * defaults so the UI can distinguish "never loaded" from "loaded as default".
   */
  settings: AppSettings | null;
  isLoading: boolean;
  error: string | null;
  /** Fetches the persisted settings from main and replaces local state. */
  loadSettings: () => Promise<void>;
  /**
   * Optimistically merges the patch into local state and queues a debounced write to main.
   *
   * Returns a Promise that resolves once the debounced write has flushed. The Promise resolves to
   * the post-write settings as confirmed by the main process, so callers can detect server-side
   * clamping or fallback values (e.g. a global hotkey accelerator the OS would not let us register
   * may come back unchanged from its previous value).
   */
  updateSettings: (patch: SettingsUpdate) => Promise<AppSettings | null>;
  /** Resets settings to defaults (round-trips through the main process). */
  resetSettings: () => Promise<void>;
  /** Reloads the settings file from disk through the main process. */
  reloadSettings: () => Promise<void>;
  openSettingsFile: () => Promise<void>;
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

function mergePatchIntoSettings(current: AppSettings, patch: SettingsUpdate): AppSettings {
  return {
    terminal: patch.terminal ? { ...current.terminal, ...patch.terminal } : current.terminal,
    paneInfo: patch.paneInfo ? { ...current.paneInfo, ...patch.paneInfo } : current.paneInfo,
    shortcuts: patch.shortcuts ? { ...current.shortcuts, ...patch.shortcuts } : current.shortcuts,
    app: patch.app ? { ...current.app, ...patch.app } : current.app,
  };
}

/**
 * Creates the renderer settings store with injectable API and debounce controls for tests.
 *
 * The store applies updates optimistically to local state and persists them to the main process on
 * a trailing debounce timer. Each `updateSettings()` call returns a Promise that resolves once the
 * pending write has flushed, so test code can `await` deterministic behavior without sleeping.
 *
 * **Tests should call this factory to obtain an isolated store rather than using the singleton
 * exported below.**
 */
export function createSettingsStore(
  options: CreateSettingsStoreOptions = {},
): UseBoundStore<StoreApi<SettingsStoreState>> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const getSettingsApi = (): SettingsApi => options.settingsApi ?? window.api.settings;

  let pendingPatch: SettingsUpdate = {};
  let debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingResolvers: Array<(settings: AppSettings | null) => void> = [];

  return create<SettingsStoreState>((set, get) => {
    const flushPendingWrite = async (): Promise<void> => {
      if (debounceTimer) {
        globalThis.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (Object.keys(pendingPatch).length === 0) {
        return;
      }

      const patch = pendingPatch;
      const resolvers = pendingResolvers;
      pendingPatch = {};
      pendingResolvers = [];

      try {
        const next = await getSettingsApi().update(patch);
        // Reconcile with the post-write authoritative state from main: this both keeps optimistic
        // local state from drifting away from disk, and gives callers a hook to surface main-side
        // fallbacks (such as a global hotkey accelerator the OS refuses to register).
        set({ settings: next, error: null });
        for (const resolve of resolvers) {
          resolve(next);
        }
      } catch (error: unknown) {
        set({ error: getErrorMessage(error) });
        for (const resolve of resolvers) {
          resolve(null);
        }
      }
    };

    return {
      settings: null,
      isLoading: false,
      error: null,
      loadSettings: async (): Promise<void> => {
        set({ isLoading: true, error: null });
        try {
          const settings = await getSettingsApi().get();
          set({ settings, isLoading: false, error: null });
        } catch (error: unknown) {
          set({ isLoading: false, error: getErrorMessage(error) });
        }
      },
      updateSettings: (patch: SettingsUpdate): Promise<AppSettings | null> => {
        const current = get().settings;
        if (current) {
          // Apply optimistically so the UI reflects the change immediately. The main-process
          // round-trip is debounced to avoid spamming disk on every keystroke / drag.
          set({ settings: mergePatchIntoSettings(current, patch) });
        }

        // Merge the patch field-by-field into the pending buffer. Sections accumulate via
        // shallow-merge so successive partial updates within the debounce window combine.
        pendingPatch = {
          terminal: patch.terminal
            ? { ...pendingPatch.terminal, ...patch.terminal }
            : pendingPatch.terminal,
          paneInfo: patch.paneInfo
            ? { ...pendingPatch.paneInfo, ...patch.paneInfo }
            : pendingPatch.paneInfo,
          shortcuts: patch.shortcuts
            ? { ...pendingPatch.shortcuts, ...patch.shortcuts }
            : pendingPatch.shortcuts,
          app: patch.app ? { ...pendingPatch.app, ...patch.app } : pendingPatch.app,
        };

        const flushPromise = new Promise<AppSettings | null>((resolve) => {
          pendingResolvers.push(resolve);
        });

        if (debounceTimer) {
          globalThis.clearTimeout(debounceTimer);
        }
        debounceTimer = globalThis.setTimeout(() => {
          void flushPendingWrite();
        }, debounceMs);

        return flushPromise;
      },
      resetSettings: async (): Promise<void> => {
        // A reset is intentionally not debounced: it is a deliberate user action and we want the
        // disk and renderer state to converge immediately. Cancel any pending optimistic write so
        // it cannot land after the reset.
        if (debounceTimer) {
          globalThis.clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        pendingPatch = {};
        const resolvers = pendingResolvers;
        pendingResolvers = [];

        try {
          const settings = await getSettingsApi().reset();
          set({ settings, error: null });
          for (const resolve of resolvers) {
            resolve(settings);
          }
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
          for (const resolve of resolvers) {
            resolve(null);
          }
        }
      },
      reloadSettings: async (): Promise<void> => {
        // A reload is a deliberate sync point after hand-editing the file. Cancel any pending
        // optimistic write first so it cannot overwrite the external edit after reload completes.
        if (debounceTimer) {
          globalThis.clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        pendingPatch = {};
        const resolvers = pendingResolvers;
        pendingResolvers = [];

        try {
          const settings = await getSettingsApi().reload();
          set({ settings, error: null });
          for (const resolve of resolvers) {
            resolve(settings);
          }
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
          for (const resolve of resolvers) {
            resolve(null);
          }
        }
      },
      openSettingsFile: async (): Promise<void> => {
        try {
          await getSettingsApi().openFile();
        } catch (error: unknown) {
          set({ error: getErrorMessage(error) });
        }
      },
    };
  });
}

/**
 * App-wide singleton settings store.
 *
 * **Tests must use {@link createSettingsStore} to construct an isolated store per test** rather
 * than reusing this singleton. See `workspaceStore.useWorkspaceStore` for the broader rationale.
 */
export const useSettingsStore = createSettingsStore();
