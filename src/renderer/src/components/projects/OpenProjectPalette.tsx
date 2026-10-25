import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { usePickerSession } from '../common/usePickerSession';
import { createProjectCandidates, filterProjectCandidates } from '../../projects/projectCandidates';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

/** Mounts one disposable picker session so cancellation invalidates pending UI transitions. */
export function OpenProjectPalette(): React.JSX.Element | null {
  const open = useUiStore((state) => state.projectPaletteOpen);
  return open ? <ProjectPicker /> : null;
}

function ProjectPicker(): React.JSX.Element {
  const focusRequest = useUiStore((state) => state.projectPaletteFocusRequest);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoading = useSettingsStore((state) => state.isLoading);
  const settingsError = useSettingsStore((state) => state.error);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceLoading = useWorkspaceStore((state) => state.isLoading);
  const workspaceError = useWorkspaceStore((state) => state.error);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const closePicker = useUiStore((state) => state.closeProjectPalette);
  const { dialogRef, inputRef, busy, error, close, submit, onKeyDown } = usePickerSession({
    focusRequest,
    selectIsOpen: (state) => state.projectPaletteOpen,
    closePicker,
  });
  const entries = useMemo(
    () =>
      createProjectCandidates(settings?.projects.directories ?? [], workspaces, activeWorkspaceId),
    [settings, workspaces, activeWorkspaceId],
  );
  const filtered = useMemo(() => filterProjectCandidates(entries, query), [entries, query]);
  const index = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  const loading =
    settingsLoading ||
    workspaceLoading ||
    (!settings && !settingsError) ||
    (!workspaces.length && !workspaceError);
  const loadError = !settings ? settingsError : workspaces.length === 0 ? workspaceError : null;
  const ready = !loading && !loadError;

  useEffect(() => {
    dialogRef.current
      ?.querySelector(`[id="project-option-${index}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [dialogRef, index, filtered]);

  const select = async (rootPath: string): Promise<void> => {
    if (!ready) return;
    await submit(
      (signal) => useWorkspaceStore.getState().openProject(rootPath, signal),
      () => {
        close(false);
        useUiStore.getState().focusWorkspace();
      },
    );
  };

  return (
    <div
      aria-label="Open Project"
      aria-modal="true"
      role="dialog"
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-20"
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <div className="flex h-12 items-center border-b border-border px-3">
          <Search aria-hidden="true" className="mr-2 shrink-0 text-muted" size={18} />
          <input
            ref={inputRef}
            aria-label="Search projects"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="project-results"
            aria-expanded="true"
            aria-activedescendant={ready && filtered[index] ? `project-option-${index}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
            placeholder="Open Project…"
            spellCheck={false}
            value={query}
            readOnly={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || busy || !ready) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (filtered.length)
                  setSelectedIndex(
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                      filtered.length,
                  );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (filtered[index]) void select(filtered[index].rootPath);
              }
            }}
          />
        </div>
        {loading && (
          <p className="p-4 text-sm text-muted" role="status">
            Loading projects…
          </p>
        )}
        {loadError && (
          <div className="p-4 text-sm text-danger" role="alert">
            Failed to load projects: {loadError}
            <button
              type="button"
              className="ml-2 underline"
              onClick={() => {
                if (!settings) void useSettingsStore.getState().loadSettings();
                if (!workspaces.length) void useWorkspaceStore.getState().loadWorkspaces();
              }}
            >
              Retry
            </button>
          </div>
        )}
        <div
          className="max-h-96 overflow-y-auto py-1"
          id="project-results"
          role="listbox"
          aria-label="Projects"
          aria-busy={busy || loading}
        >
          {ready &&
            filtered.map((entry, position) => (
              <button
                type="button"
                role="option"
                id={`project-option-${position}`}
                key={entry.rootPath}
                tabIndex={-1}
                aria-selected={position === index}
                disabled={busy}
                className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm ${position === index ? 'bg-raised' : 'hover:bg-raised/50'}`}
                onMouseEnter={() => {
                  if (!busy) setSelectedIndex(position);
                }}
                onClick={() => {
                  void select(entry.rootPath);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{entry.name}</span>
                  <span className="block truncate text-xs text-muted" title={entry.rootPath}>
                    {entry.rootPath}
                  </span>
                </span>
                {entry.status && <span className="text-xs text-muted">{entry.status}</span>}
              </button>
            ))}
        </div>
        {ready && filtered.length === 0 && (
          <div className="p-4 text-center text-sm text-muted">
            <p>{entries.length ? 'No projects match' : 'No projects registered yet'}</p>
            {!entries.length && (
              <button
                type="button"
                className="mt-2 underline"
                onClick={() => {
                  close(false);
                  useUiStore.getState().openSettings('projects');
                }}
              >
                Open Projects settings
              </button>
            )}
          </div>
        )}
        {busy && (
          <p role="status" className="px-4 py-2 text-sm text-muted">
            Opening project…
          </p>
        )}
        {error && (
          <p role="alert" className="px-4 py-2 text-sm text-danger">
            Failed to open project: {error}. Select the project to retry.
          </p>
        )}
      </div>
    </div>
  );
}
