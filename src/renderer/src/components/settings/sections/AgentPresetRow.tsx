import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { getAgentPresetFieldsError } from '../../../../../shared/agent-presets';
import type { AgentPreset } from '../../../../../shared/types';

interface AgentPresetRowProps {
  preset: AgentPreset;
  onCommit: (id: string, fields: Pick<AgentPreset, 'label' | 'command'>) => void;
  onRemove: (id: string) => void;
}

/** Keeps incomplete commands out of persisted settings, where sanitization would remove the row. */
export function AgentPresetRow({
  preset,
  onCommit,
  onRemove,
}: AgentPresetRowProps): React.JSX.Element {
  const [saved, setSaved] = useState(preset);
  const [label, setLabel] = useState(preset.label);
  const [command, setCommand] = useState(preset.command);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  // Name controls by the saved values rather than the id, which is a UUID for user-added rows.
  const name = preset.label || preset.command;
  // Compare values, not references: another row's save returns fresh objects for every preset.
  if (saved.label !== preset.label || saved.command !== preset.command) {
    setSaved(preset);
    setLabel(preset.label);
    setCommand(preset.command);
    setError(null);
  }
  const commit = (): void => {
    const nextError = getAgentPresetFieldsError(label, command);
    setError(nextError);
    if (!nextError && (label !== preset.label || command !== preset.command)) {
      onCommit(preset.id, { label, command });
    }
  };
  return (
    <li className="rounded border border-border p-2">
      <div
        className="flex items-center gap-2"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            // Buttons retain their native Enter activation, including removal.
            if (!(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            // Without a draft, let Esc reach AppShell so it can still dismiss the settings view.
            if (label === preset.label && command === preset.command) return;
            event.preventDefault();
            event.stopPropagation();
            setLabel(preset.label);
            setCommand(preset.command);
            setError(null);
          }
        }}
      >
        <input
          aria-label={`Label for ${name}`}
          className="min-w-0 w-1/3 rounded border border-border bg-raised px-2 py-1 text-sm"
          value={label}
          placeholder="Label (optional)"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commit}
        />
        <input
          aria-label={`Command for ${name}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 rounded border border-border bg-raised px-2 py-1 font-mono text-sm"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onBlur={commit}
        />
        <button
          aria-label={`Remove ${name}`}
          className="rounded p-1 text-muted hover:bg-raised hover:text-foreground"
          type="button"
          onClick={() => onRemove(preset.id)}
        >
          <X size={14} />
        </button>
      </div>
      {error ? (
        <p role="alert" id={errorId} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}
