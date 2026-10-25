import { useState } from 'react';
import { getAgentPresetFieldsError, MAX_AGENT_PRESETS } from '../../../../../shared/agent-presets';
import type { AgentPreset } from '../../../../../shared/types';
import { createAgentPresetGroups } from '../../../agents/presetGroups';
import { createProjectCandidates } from '../../../projects/projectCandidates';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { AgentPresetRow } from './AgentPresetRow';

/** Manages shared and project-scoped commands through the existing debounced settings API. */
export function AgentPresetsSection(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const saveError = useSettingsStore((state) => state.error);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const [scope, setScope] = useState('');
  const [label, setLabel] = useState('');
  const [command, setCommand] = useState('');
  const candidates = createProjectCandidates(
    settings?.projects.directories ?? [],
    workspaces,
    activeWorkspaceId,
  );
  const presets = settings?.agents.presets ?? [];
  const groups = createAgentPresetGroups(presets, candidates);
  // A project can disappear while this form is open. Never add to an invisible stale scope.
  const effectiveScope = candidates.some((candidate) => candidate.rootPath === scope) ? scope : '';
  const write = (transform: (current: AgentPreset[]) => AgentPreset[]): void => {
    const store = useSettingsStore.getState();
    if (!store.settings) return;
    void store.updateSettings({ agents: { presets: transform(store.settings.agents.presets) } });
  };
  const fieldError = getAgentPresetFieldsError(label, command);
  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Agent presets</h2>
        <p className="mt-1 text-xs leading-5 text-muted">
          Commands offered by Launch Agent. Launch Agent lists project presets before shared ones.
        </p>
      </header>
      {!settings ? (
        <p className="text-sm text-muted">Loading agent presets…</p>
      ) : (
        groups.map((group) => (
          <section key={group.rootPath ?? 'shared'} className="border-b border-border-subtle py-4">
            <h3 className="mb-2 text-sm font-medium">{group.name}</h3>
            {group.rootPath && group.name !== group.rootPath ? (
              <p className="mb-2 break-all font-mono text-xs text-muted">{group.rootPath}</p>
            ) : null}
            {/* Only the shared group can be empty; project groups exist only for their presets. */}
            {group.presets.length ? (
              <ul aria-label={`${group.name} presets`} className="flex flex-col gap-2">
                {group.presets.map((preset) => (
                  <AgentPresetRow
                    key={preset.id}
                    preset={preset}
                    onCommit={(id, fields) =>
                      write((current) =>
                        current.map((entry) => (entry.id === id ? { ...entry, ...fields } : entry)),
                      )
                    }
                    onRemove={(id) =>
                      write((current) => current.filter((entry) => entry.id !== id))
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No shared presets.</p>
            )}
          </section>
        ))
      )}
      <form
        className="mt-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!settings || fieldError || presets.length >= MAX_AGENT_PRESETS) return;
          const preset: AgentPreset = {
            id: crypto.randomUUID(),
            label,
            command,
            ...(effectiveScope ? { rootPath: effectiveScope } : {}),
          };
          write((current) => (current.length < MAX_AGENT_PRESETS ? [...current, preset] : current));
          setLabel('');
          setCommand('');
        }}
      >
        <select
          aria-label="Preset scope"
          value={effectiveScope}
          disabled={!settings}
          className="max-w-full rounded border border-border bg-raised px-2 py-1 text-sm"
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="">All projects</option>
          {candidates.map((candidate) => (
            <option key={candidate.rootPath} value={candidate.rootPath}>
              {candidate.name} — {candidate.rootPath}
            </option>
          ))}
        </select>
        <input
          aria-label="New preset label"
          placeholder="Label (optional)"
          value={label}
          disabled={!settings}
          className="min-w-0 rounded border border-border bg-raised px-2 py-1 text-sm"
          onChange={(event) => setLabel(event.target.value)}
        />
        <input
          aria-label="New preset command"
          placeholder="Command"
          value={command}
          disabled={!settings}
          className="min-w-0 flex-1 rounded border border-border bg-raised px-2 py-1 font-mono text-sm"
          onChange={(event) => setCommand(event.target.value)}
        />
        <button
          type="submit"
          disabled={!settings || Boolean(fieldError) || presets.length >= MAX_AGENT_PRESETS}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-raised disabled:opacity-50"
        >
          Add preset
        </button>
      </form>
      {fieldError && command.length > 0 ? (
        <p className="mt-2 text-xs text-danger">{fieldError}</p>
      ) : null}
      {presets.length >= MAX_AGENT_PRESETS ? (
        <p className="mt-2 text-xs text-muted">At most {MAX_AGENT_PRESETS} presets can be saved.</p>
      ) : null}
      {saveError ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          Failed to save settings: {saveError}
        </p>
      ) : null}
    </div>
  );
}
