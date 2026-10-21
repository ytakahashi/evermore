import { useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

/**
 * Renders the list of directories registered as projects.
 *
 * Directories are added through the native picker rather than a free-text field so the persisted
 * value is always an absolute path the OS has confirmed. The main-process settings layer still
 * normalizes and deduplicates the list, which also covers hand-edited `settings.json` entries.
 */
export function ProjectsSection(): React.JSX.Element {
  const directories =
    useSettingsStore((state) => state.settings?.projects.directories) ??
    DEFAULT_APP_SETTINGS.projects.directories;
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [pickError, setPickError] = useState<string | null>(null);

  const setDirectories = (next: string[]): void => {
    void updateSettings({ projects: { directories: next } });
  };

  const handleAdd = async (): Promise<void> => {
    setPickError(null);
    let picked: string | null;
    try {
      picked = await window.api.window.pickDirectory();
    } catch (error: unknown) {
      setPickError(error instanceof Error ? error.message : 'Unknown error');
      return;
    }
    // Read the latest list after the picker settles: the dialog is modal to the window, but a
    // settings reload can still land while it is open.
    const current =
      useSettingsStore.getState().settings?.projects.directories ??
      DEFAULT_APP_SETTINGS.projects.directories;
    if (picked === null || current.includes(picked)) {
      return;
    }
    setDirectories([...current, picked]);
  };

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Projects</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Directories registered here are offered as projects you can open as a workspace.
        </p>
      </header>

      <div className="border-b border-border-subtle py-4">
        {directories.length === 0 ? (
          <p className="text-sm text-muted">No project directories registered yet.</p>
        ) : (
          <ul aria-label="Project directories" className="flex flex-col gap-1">
            {directories.map((directory) => (
              <li
                className="flex items-center gap-2 rounded border border-border px-2 py-1"
                key={directory}
              >
                <code className="min-w-0 flex-1 truncate font-mono text-xs" title={directory}>
                  {directory}
                </code>
                <button
                  aria-label={`Remove ${directory}`}
                  className="rounded p-1 text-muted hover:bg-raised hover:text-foreground"
                  onClick={() => {
                    setDirectories(directories.filter((entry) => entry !== directory));
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            className="rounded border border-border px-2 py-1 text-xs hover:bg-raised"
            onClick={() => {
              void handleAdd();
            }}
            type="button"
          >
            Add directory…
          </button>
          {pickError ? (
            <span className="text-xs text-danger">Failed to open picker: {pickError}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
