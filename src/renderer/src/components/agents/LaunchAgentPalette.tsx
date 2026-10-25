import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  createLaunchTargets,
  filterLaunchPresets,
  getPresetsForTarget,
  pickDefaultPreset,
  type LaunchCandidate,
} from '../../agents/launchCandidates';
import type { AgentPreset } from '../../../../shared/types';
import { filterProjectCandidates } from '../../projects/projectCandidates';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { usePickerSession } from '../common/usePickerSession';

/** Mounts one disposable two-step launch session, sharing modal lifecycle with Open Project. */
export function LaunchAgentPalette(): React.JSX.Element | null {
  const open = useUiStore((state) => state.launchPaletteOpen);
  return open ? <LaunchPicker /> : null;
}

function LaunchPicker(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoading = useSettingsStore((state) => state.isLoading);
  const settingsError = useSettingsStore((state) => state.error);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceLoading = useWorkspaceStore((state) => state.isLoading);
  const workspaceError = useWorkspaceStore((state) => state.error);
  const focusRequest = useUiStore((state) => state.launchPaletteFocusRequest);
  const lastPresetId = useUiStore((state) => state.lastAgentPresetId);
  // The entry view, rather than the current view after asynchronous work, decides navigation.
  const [originView] = useState(() => useUiStore.getState().activeView);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectKey, setProjectKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<LaunchCandidate | null>(null);
  const [presetQuery, setPresetQuery] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const { dialogRef, inputRef, busy, error, close, submit, onKeyDown } = usePickerSession({
    focusRequest,
    selectIsOpen: (state) => state.launchPaletteOpen,
    closePicker: () => useUiStore.getState().closeLaunchPalette(),
  });
  const { candidates, defaultKey } = createLaunchTargets(
    settings?.projects.directories ?? [],
    workspaces,
    activeWorkspaceId,
  );
  // The generic filter keeps each candidate's target identity.
  const projects = filterProjectCandidates(candidates, projectQuery);
  const selectedProject =
    projects.find((candidate) => candidate.key === (projectKey ?? defaultKey)) ?? projects[0];
  const presets = chosen ? getPresetsForTarget(settings?.agents.presets ?? [], chosen.target) : [];
  const filteredPresets = filterLaunchPresets(presets, presetQuery);
  const selectedPreset =
    filteredPresets.find(
      (preset) => preset.id === (presetId ?? pickDefaultPreset(presets, lastPresetId)),
    ) ?? filteredPresets[0];
  const loading =
    settingsLoading ||
    workspaceLoading ||
    (!settings && !settingsError) ||
    (!workspaces.length && !workspaceError);
  const loadError = !settings ? settingsError : !workspaces.length ? workspaceError : null;
  const ready = !loading && !loadError;
  const selectedIndex = chosen
    ? filteredPresets.indexOf(selectedPreset!)
    : projects.indexOf(selectedProject!);

  useEffect(() => {
    dialogRef.current
      ?.querySelector(`[id="launch-option-${selectedIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [dialogRef, selectedIndex, chosen, projectQuery, presetQuery]);

  const chooseProject = (candidate: LaunchCandidate): void => {
    if (!ready || busy) return;
    setProjectKey(candidate.key);
    setChosen(candidate);
    setPresetQuery('');
    setPresetId(null);
    inputRef.current?.focus();
  };
  const back = (): void => {
    setChosen(null);
    inputRef.current?.focus();
  };
  const launch = async (preset: AgentPreset): Promise<void> => {
    if (!chosen || !ready) return;
    await submit(
      (signal) => useWorkspaceStore.getState().launchAgent(chosen.target, preset, signal),
      (result) => {
        const ui = useUiStore.getState();
        ui.rememberAgentPreset(preset.id);
        if (originView === 'agents') {
          ui.requestAgentSelection(result.paneId);
          close();
        } else {
          close(false);
          useWorkspaceStore
            .getState()
            .selectWorkspacePane(result.workspaceId, result.tabId, result.paneId);
          ui.focusWorkspace();
        }
      },
    );
  };
  const count = chosen ? filteredPresets.length : projects.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Launch Agent"
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-20"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          close();
        }
      }}
      onKeyDown={(event) => {
        if (
          chosen &&
          !busy &&
          event.key === 'Escape' &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        ) {
          event.preventDefault();
          back();
        }
        onKeyDown(event);
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <div className="flex min-h-12 items-center gap-2 border-b border-border px-3">
          {chosen && (
            <button
              type="button"
              disabled={busy}
              aria-label="Change project"
              className="flex max-w-56 items-center gap-1 rounded bg-raised px-2 py-1 text-xs"
              onClick={back}
            >
              <span className="truncate">{chosen.name}</span>
              <X size={12} />
            </button>
          )}
          <Search aria-hidden="true" className="shrink-0 text-muted" size={18} />
          <input
            ref={inputRef}
            aria-label={chosen ? 'Search presets' : 'Search projects'}
            placeholder={chosen ? 'Search presets…' : 'Search projects…'}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="launch-results"
            aria-expanded="true"
            aria-activedescendant={
              ready && selectedIndex >= 0 ? `launch-option-${selectedIndex}` : undefined
            }
            className="min-w-0 flex-1 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-subtle"
            spellCheck={false}
            readOnly={busy}
            value={chosen ? presetQuery : projectQuery}
            onChange={(event) => {
              if (chosen) {
                setPresetQuery(event.target.value);
                setPresetId(null);
              } else {
                setProjectQuery(event.target.value);
                setProjectKey(null);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
                busy ||
                !ready
              )
                return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!count) return;
                const next = (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
                if (chosen) setPresetId(filteredPresets[next].id);
                else setProjectKey(projects[next].key);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (chosen) {
                  if (selectedPreset) void launch(selectedPreset);
                } else if (selectedProject) chooseProject(selectedProject);
              }
            }}
          />
        </div>
        {loading && (
          <p role="status" className="p-4 text-sm text-muted">
            Loading launch options…
          </p>
        )}
        {loadError && (
          <div role="alert" className="p-4 text-sm text-danger">
            Failed to load launch options: {loadError}
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
          id="launch-results"
          role="listbox"
          aria-label={chosen ? 'Presets' : 'Projects'}
          aria-busy={busy || loading}
          className="max-h-96 overflow-y-auto py-1"
        >
          {ready &&
            (chosen
              ? filteredPresets.map((preset, index) => (
                  <button
                    key={preset.id}
                    type="button"
                    role="option"
                    id={`launch-option-${index}`}
                    tabIndex={-1}
                    aria-selected={preset.id === selectedPreset?.id}
                    disabled={busy}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm ${preset.id === selectedPreset?.id ? 'bg-raised' : 'hover:bg-raised/50'}`}
                    onMouseEnter={() => {
                      if (!busy) setPresetId(preset.id);
                    }}
                    onClick={() => {
                      void launch(preset);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {preset.label || preset.command}
                      </span>
                      <span
                        className="block truncate font-mono text-xs text-muted"
                        title={preset.command}
                      >
                        {preset.command}
                      </span>
                    </span>
                    {preset.rootPath !== undefined && (
                      <span className="shrink-0 text-xs text-muted">Project preset</span>
                    )}
                  </button>
                ))
              : projects.map((candidate, index) => (
                  <button
                    key={candidate.key}
                    type="button"
                    role="option"
                    id={`launch-option-${index}`}
                    tabIndex={-1}
                    aria-selected={candidate.key === selectedProject?.key}
                    disabled={busy}
                    className={`flex w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm ${candidate.key === selectedProject?.key ? 'bg-raised' : 'hover:bg-raised/50'}`}
                    onMouseEnter={() => {
                      if (!busy) setProjectKey(candidate.key);
                    }}
                    onClick={() => chooseProject(candidate)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{candidate.name}</span>
                      <span
                        className="block truncate text-xs text-muted"
                        title={candidate.rootPath}
                      >
                        {candidate.rootPath}
                      </span>
                    </span>
                    {candidate.status && (
                      <span className="text-xs text-muted">{candidate.status}</span>
                    )}
                  </button>
                )))}
        </div>
        {ready && !count && (
          <div className="p-4 text-center text-sm text-muted">
            <p>
              {chosen
                ? presets.length
                  ? 'No presets match'
                  : 'No presets available'
                : 'No projects match'}
            </p>
            {chosen && !presets.length && (
              <button
                type="button"
                className="mt-2 underline"
                onClick={() => {
                  close(false);
                  useUiStore.getState().openSettings('agentPresets');
                }}
              >
                Open Agent presets settings
              </button>
            )}
          </div>
        )}
        {busy && (
          <p role="status" className="px-4 py-2 text-sm text-muted">
            Launching agent…
          </p>
        )}
        {error && (
          <p role="alert" className="px-4 py-2 text-sm text-danger">
            Failed to launch agent: {error}
          </p>
        )}
      </div>
    </div>
  );
}
