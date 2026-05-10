import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';

/**
 * "About / Advanced" settings section.
 *
 * Shows the absolute path to the persisted settings file and lets the user reveal it in the
 * platform file manager. The other settings sections currently render placeholder copy (their
 * controls are added later); this one is the first fully-functional section so users can already
 * locate the file and edit it by hand if they want to.
 */
export function AboutSection(): React.JSX.Element {
  const openSettingsFile = useSettingsStore((state) => state.openSettingsFile);
  const reloadSettings = useSettingsStore((state) => state.reloadSettings);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [filePathError, setFilePathError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [reloadState, setReloadState] = useState<'idle' | 'reloaded'>('idle');

  useEffect(() => {
    let cancelled = false;
    void window.api.settings
      .getFilePath()
      .then((path) => {
        if (!cancelled) {
          setFilePath(path);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFilePathError(error instanceof Error ? error.message : 'Unknown error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async (path: string): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyState('error');
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setCopyState('copied');
      // Reset after a moment so a later copy click can re-flash the badge.
      globalThis.setTimeout(() => {
        setCopyState('idle');
      }, 1500);
    } catch {
      setCopyState('error');
    }
  };

  return (
    <div>
      <header className="mb-3">
        <h2 className="text-base font-semibold">About / Advanced</h2>
      </header>
      <div className="flex flex-col gap-2 text-sm">
        <div>
          <div className="text-muted">Settings file</div>
          {filePath ? (
            <code className="block break-all rounded bg-raised px-2 py-1 font-mono text-xs">
              {filePath}
            </code>
          ) : filePathError ? (
            <div className="text-danger">Failed to load: {filePathError}</div>
          ) : (
            <div className="text-muted">Loading…</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded border border-border px-2 py-1 text-xs hover:bg-raised disabled:opacity-50"
            disabled={!filePath}
            onClick={() => {
              if (filePath) {
                void handleCopy(filePath);
              }
            }}
            type="button"
          >
            Copy path
          </button>
          <button
            className="rounded border border-border px-2 py-1 text-xs hover:bg-raised disabled:opacity-50"
            disabled={!filePath}
            onClick={() => {
              void openSettingsFile();
            }}
            type="button"
          >
            Open in Finder
          </button>
          <button
            className="rounded border border-border px-2 py-1 text-xs hover:bg-raised disabled:opacity-50"
            disabled={!filePath}
            onClick={() => {
              void reloadSettings().then(() => {
                if (useSettingsStore.getState().error) {
                  return;
                }
                setReloadState('reloaded');
                globalThis.setTimeout(() => {
                  setReloadState('idle');
                }, 1500);
              });
            }}
            type="button"
          >
            Reload from disk
          </button>
          {copyState === 'copied' ? (
            <span className="text-xs text-muted">Copied</span>
          ) : copyState === 'error' ? (
            <span className="text-xs text-danger">Copy failed</span>
          ) : null}
          {reloadState === 'reloaded' ? <span className="text-xs text-muted">Reloaded</span> : null}
        </div>
      </div>
    </div>
  );
}
