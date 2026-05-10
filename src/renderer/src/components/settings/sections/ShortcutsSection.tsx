import { useState } from 'react';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

interface AcceleratorPickerProps {
  ariaLabel: string;
  onChange: (accelerator: string | null) => void;
  value: string | null;
}

function formatAccelerator(value: string | null): string {
  return value ?? 'Disabled';
}

function keyToAcceleratorPart(event: React.KeyboardEvent<HTMLInputElement>): string | null {
  if (event.key === ',' || event.code === 'Comma') {
    return ',';
  }
  if (event.key === ' ') {
    return 'Space';
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }

  const namedKeys: Record<string, string> = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Delete: 'Delete',
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
  };

  return namedKeys[event.key] ?? null;
}

function eventToAccelerator(
  event: React.KeyboardEvent<HTMLInputElement>,
): string | null | undefined {
  if (event.key === 'Backspace') {
    return null;
  }

  const keyPart = keyToAcceleratorPart(event);
  if (!keyPart || ['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) {
    return undefined;
  }

  // macOS-only app: map each modifier to its keyboard label rather than collapsing Cmd / Ctrl
  // into the cross-platform `CommandOrControl` token. This keeps the persisted accelerator string
  // matching what the user sees on the keyboard and aligned with the default in settings-defaults.
  const parts: string[] = [];
  if (event.metaKey) {
    parts.push('Command');
  }
  if (event.ctrlKey) {
    parts.push('Control');
  }
  if (event.altKey) {
    parts.push('Option');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }
  parts.push(keyPart);

  return parts.join('+');
}

function AcceleratorPicker({
  ariaLabel,
  onChange,
  value,
}: AcceleratorPickerProps): React.JSX.Element {
  return (
    <input
      aria-label={ariaLabel}
      className="w-64 rounded border border-border bg-background px-2 py-1 font-mono text-sm"
      onKeyDown={(event) => {
        const accelerator = eventToAccelerator(event);
        if (accelerator === undefined) {
          return;
        }

        event.preventDefault();
        onChange(accelerator);
      }}
      readOnly
      type="text"
      value={formatAccelerator(value)}
    />
  );
}

/**
 * Renders hotkey and stored keybinding settings.
 */
export function ShortcutsSection(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings) ?? DEFAULT_APP_SETTINGS;
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const keybindingEntries = Object.entries(settings.shortcuts.keybindings);

  const updateHotkey = (accelerator: string | null): void => {
    setHotkeyError(null);
    void updateSettings({ shortcuts: { activateAppHotkey: accelerator } }).then((confirmed) => {
      if (!confirmed || confirmed.shortcuts.activateAppHotkey === accelerator) {
        return;
      }

      setHotkeyError(
        `${formatAccelerator(accelerator)} is already used by another app. Press a different shortcut, or use Backspace to disable.`,
      );
    });
  };

  const updateKeybinding = (actionId: string, accelerator: string | null): void => {
    const nextKeybindings = { ...settings.shortcuts.keybindings };
    if (accelerator === null) {
      delete nextKeybindings[actionId];
    } else {
      nextKeybindings[actionId] = accelerator;
    }

    void updateSettings({ shortcuts: { keybindings: nextKeybindings } });
  };

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Shortcuts</h2>
      </header>

      <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Activate Evermore</h3>
            <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Live</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Focuses the Evermore window from anywhere on the system. Click the field and press a
            shortcut. Backspace disables it.
          </p>
          {hotkeyError ? <p className="mt-2 text-xs leading-5 text-danger">{hotkeyError}</p> : null}
        </div>
        <div className="flex items-center sm:justify-end">
          <AcceleratorPicker
            ariaLabel="Activate Evermore hotkey"
            onChange={updateHotkey}
            value={settings.shortcuts.activateAppHotkey}
          />
        </div>
      </div>

      <section className="py-4">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-medium">Stored keybindings</h3>
          <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Saved only</span>
        </div>
        <p className="mb-3 max-w-2xl text-xs leading-5 text-muted">
          These values are persisted for the future keyboard-shortcut binding phase. They are not
          connected to runtime behavior yet.
        </p>
        {keybindingEntries.length > 0 ? (
          <div className="flex flex-col gap-2">
            {keybindingEntries.map(([actionId, accelerator]) => (
              <div
                className="grid items-center gap-2 rounded border border-border px-3 py-2 sm:grid-cols-[1fr_auto]"
                key={actionId}
              >
                <span className="font-mono text-xs text-muted">{actionId}</span>
                <AcceleratorPicker
                  ariaLabel={`${actionId} keybinding`}
                  onChange={(nextAccelerator) => {
                    updateKeybinding(actionId, nextAccelerator);
                  }}
                  value={accelerator}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No per-action keybindings are stored yet.</p>
        )}
      </section>
    </div>
  );
}
