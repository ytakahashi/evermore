import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // True while this picker is mounted. `openProject` can resolve after unmount, and its
  // continuation must not set state or move focus for a session the user already left.
  const sessionRef = useRef(false);
  // Aborted on every exit path (Escape, backdrop, navigation, unmount). Aborting cannot undo a
  // create/reopen that main already persisted; it only stops the store from activating the result.
  const controllerRef = useRef<AbortController | null>(null);
  // Synchronous double-submit guard. `busy` state lags a render behind, so a repeated Enter in the
  // same tick would otherwise start a second request.
  const submittingRef = useRef(false);
  // Cleared by exits that choose their own focus destination (a completed selection focuses the
  // terminal, the empty-state link opens Settings) so unmount does not pull focus back.
  const restoreFocusRef = useRef(true);
  // The element focused before this picker opened, recorded once per session. StrictMode replays
  // the mount effect after the input already has focus, so a per-run capture would record the input.
  const previousFocusRef = useRef<Element | null>(null);
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

  // A layout effect so the input is focused and the previous focus is captured before paint, and
  // so cleanup runs before passive effects of the next view (such as terminal focus) on close.
  useLayoutEffect(() => {
    sessionRef.current = true;
    controllerRef.current = new AbortController();
    const unsubscribe = useUiStore.subscribe((current, previous) => {
      // Navigation behind the modal invalidates the session, including any pending selection.
      if (current.activeView !== previous.activeView && current.projectPaletteOpen) {
        controllerRef.current?.abort();
        current.closeProjectPalette();
      }
    });
    const previousFocus = (previousFocusRef.current ??= document.activeElement);
    const previousView = useUiStore.getState().activeView;
    inputRef.current?.focus();
    return () => {
      sessionRef.current = false;
      unsubscribe();
      controllerRef.current?.abort();
      const ui = useUiStore.getState();
      // Switching palettes or completing a selection owns its next focus destination.
      if (
        restoreFocusRef.current &&
        !ui.tabSearchOpen &&
        !ui.projectPaletteOpen &&
        ui.activeView === previousView &&
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected
      ) {
        previousFocus.focus();
      }
    };
  }, []);

  // Invoking Open Project while already open refocuses the input without resetting the query.
  useEffect(() => {
    inputRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    dialogRef.current
      ?.querySelector(`[id="project-option-${index}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [index, filtered]);

  const close = (): void => {
    controllerRef.current?.abort();
    useUiStore.getState().closeProjectPalette();
  };
  const select = async (rootPath: string): Promise<void> => {
    if (submittingRef.current || !ready) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    const previousView = useUiStore.getState().activeView;
    try {
      await useWorkspaceStore.getState().openProject(rootPath, controllerRef.current?.signal);
      const ui = useUiStore.getState();
      // The user may have dismissed or navigated away during IPC; the project stays persisted but
      // the picker must not override the view they moved to.
      if (!sessionRef.current || !ui.projectPaletteOpen || ui.activeView !== previousView) return;
      restoreFocusRef.current = false;
      close();
      useUiStore.getState().focusWorkspace();
    } catch (caught: unknown) {
      if (sessionRef.current) setError(caught instanceof Error ? caught.message : 'Unknown error');
    } finally {
      submittingRef.current = false;
      if (sessionRef.current) setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Escape during IME composition cancels the composition only. It still must not bubble to
    // view-level handlers such as Agents view's Escape-to-return.
    if (event.nativeEvent.isComposing) {
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      // Trap Tab inside the modal. Options are excluded because they are reached with arrows via
      // `aria-activedescendant`, not as separate tab stops.
      const controls = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled):not([role="option"])',
        ) ?? []),
      ];
      const current = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
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
                  restoreFocusRef.current = false;
                  close();
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
