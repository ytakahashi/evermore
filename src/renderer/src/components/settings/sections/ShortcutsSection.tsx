import { useMemo, useState } from 'react';
import {
  ACTION_LABELS,
  DEFAULT_KEYBINDINGS,
  formatAcceleratorForDisplay,
  KEYBOARD_SHORTCUT_ACTION_IDS,
  STANDARD_ROLE_ACCELERATOR_SET,
  type KeyboardShortcutActionId,
} from '../../../../../shared/keyboard-shortcuts';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

interface AcceleratorPickerProps {
  ariaLabel: string;
  /**
   * Space-separated id list passed through to `aria-describedby`. Used to attach the surrounding
   * "click a field and press a shortcut" instructions (and the inline hotkey error, when present)
   * so a screen-reader user understands this is a key-capture field rather than a normal textbox.
   */
  ariaDescribedBy?: string;
  onChange: (accelerator: string | null) => void;
  value: string | null;
  /**
   * When set, the picker renders in a read-only "disabled" affordance: the field shows
   * `placeholder` instead of `value`, looks dimmed, and only accepts Backspace (which still fires
   * `onChange(null)` so callers can route it to default recovery).
   */
  disabled?: boolean;
  /** Display text used while `disabled`. Defaults to `(disabled)`. */
  placeholder?: string;
}

function formatAccelerator(value: string | null): string {
  if (value === null) {
    return 'Disabled';
  }
  return formatAcceleratorForDisplay(value);
}

function keyToAcceleratorPart(event: React.KeyboardEvent<HTMLElement>): string | null {
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

function eventToAccelerator(event: React.KeyboardEvent<HTMLElement>): string | null | undefined {
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
  ariaDescribedBy,
  onChange,
  value,
  disabled,
  placeholder,
}: AcceleratorPickerProps): React.JSX.Element {
  const displayValue = disabled ? (placeholder ?? '(disabled)') : formatAccelerator(value);
  return (
    <div
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      aria-readonly="true"
      className={
        'flex h-7 w-64 items-center rounded border border-border bg-background px-2 text-sm tabular-nums focus:border-brand focus:outline-none' +
        (disabled ? ' text-muted opacity-70' : '')
      }
      onKeyDown={(event) => {
        if (disabled) {
          // Disabled rows accept Backspace only — it routes to default recovery via onChange(null).
          if (event.key === 'Backspace') {
            event.preventDefault();
            onChange(null);
          }
          return;
        }

        const accelerator = eventToAccelerator(event);
        if (accelerator === undefined) {
          return;
        }

        event.preventDefault();
        onChange(accelerator);
      }}
      role="textbox"
      tabIndex={0}
    >
      {displayValue}
    </div>
  );
}

interface KeybindingRowConflict {
  /** Other Evermore action ids whose accelerator equals this row's accelerator. */
  duplicates: KeyboardShortcutActionId[];
  /** True when this row's accelerator collides with a macOS standard role binding. */
  withRole: boolean;
  /** True when this row's accelerator equals the global activate-app hotkey. */
  withHotkey: boolean;
}

/**
 * Builds the conflict map for the current keybinding state.
 *
 * Three categories are reported (see PR plan / design):
 *  - Evermore action ↔ Evermore action (`duplicates`): two rows with the same non-empty
 *    accelerator. Both rows surface a warning pointing at each other.
 *  - Evermore action ↔ macOS standard role (`withRole`): the user picked an accelerator already
 *    claimed by the application menu's role items (`Cmd+C` / `Cmd+V` / `Cmd+Q` etc.).
 *  - Evermore action ↔ global hotkey (`withHotkey`): the row's accelerator equals
 *    `shortcuts.activateAppHotkey`.
 *
 * `""` rows are treated as "no binding" — they cannot conflict with anything.
 */
function computeConflicts(
  keybindings: Record<string, string>,
  activateAppHotkey: string | null,
): Map<KeyboardShortcutActionId, KeybindingRowConflict> {
  const byAccelerator = new Map<string, KeyboardShortcutActionId[]>();
  for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
    const value = keybindings[actionId];
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    const bucket = byAccelerator.get(value);
    if (bucket) {
      bucket.push(actionId);
    } else {
      byAccelerator.set(value, [actionId]);
    }
  }

  const result = new Map<KeyboardShortcutActionId, KeybindingRowConflict>();
  for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
    const value = keybindings[actionId];
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    const sameAccelerator = byAccelerator.get(value) ?? [];
    const duplicates = sameAccelerator.filter((other) => other !== actionId);
    const withRole = STANDARD_ROLE_ACCELERATOR_SET.has(value);
    const withHotkey = activateAppHotkey !== null && activateAppHotkey === value;
    if (duplicates.length === 0 && !withRole && !withHotkey) {
      continue;
    }
    result.set(actionId, { duplicates, withRole, withHotkey });
  }
  return result;
}

function formatConflictMessage(conflict: KeybindingRowConflict): string {
  const reasons: string[] = [];
  if (conflict.duplicates.length > 0) {
    const labels = conflict.duplicates.map((actionId) => ACTION_LABELS[actionId]).join(', ');
    reasons.push(`also bound to ${labels}`);
  }
  if (conflict.withRole) {
    reasons.push('reserved by a macOS menu role');
  }
  if (conflict.withHotkey) {
    reasons.push('matches the global Activate Evermore hotkey');
  }
  return `Conflicts: ${reasons.join('; ')}.`;
}

/**
 * Renders hotkey and stored keybinding settings.
 */
export function ShortcutsSection(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings) ?? DEFAULT_APP_SETTINGS;
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  const conflicts = useMemo(
    () => computeConflicts(settings.shortcuts.keybindings, settings.shortcuts.activateAppHotkey),
    [settings.shortcuts.keybindings, settings.shortcuts.activateAppHotkey],
  );

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

  const updateKeybinding = (
    actionId: KeyboardShortcutActionId,
    accelerator: string | null,
  ): void => {
    const nextKeybindings = { ...settings.shortcuts.keybindings };
    if (accelerator === null) {
      // `null` from the picker means "restore default": dropping the user override lets the
      // settings store's read path merge the default back in on the next read.
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
          <h3 className="text-sm font-medium">Activate Evermore</h3>
          <p
            className="mt-1 max-w-2xl text-xs leading-5 text-muted"
            id="shortcuts-hotkey-description"
          >
            Focuses the Evermore window from anywhere on the system. Click the field and press a
            shortcut. Backspace disables it.
          </p>
          {hotkeyError ? (
            <p className="mt-2 text-xs leading-5 text-danger" id="shortcuts-hotkey-error">
              {hotkeyError}
            </p>
          ) : null}
        </div>
        <div className="flex items-center sm:justify-end">
          <AcceleratorPicker
            ariaLabel="Activate Evermore hotkey"
            ariaDescribedBy={
              hotkeyError
                ? 'shortcuts-hotkey-description shortcuts-hotkey-error'
                : 'shortcuts-hotkey-description'
            }
            onChange={updateHotkey}
            value={settings.shortcuts.activateAppHotkey}
          />
        </div>
      </div>

      <section className="py-4">
        <h3 className="mb-3 text-sm font-medium">Keybindings</h3>
        <p
          className="mb-3 max-w-2xl text-xs leading-5 text-muted"
          id="shortcuts-keybindings-description"
        >
          Click a field and press a shortcut to rebind the action. Backspace restores the default.
          Conflicts with another action, a macOS menu role, or the global hotkey are highlighted but
          not blocked — the actual winner is decided by the application menu and OS at runtime.
        </p>
        <div className="flex flex-col gap-2">
          {KEYBOARD_SHORTCUT_ACTION_IDS.map((actionId) => {
            const current = settings.shortcuts.keybindings[actionId];
            const isExplicitlyUnbound = current === '';
            const value = isExplicitlyUnbound ? null : (current ?? DEFAULT_KEYBINDINGS[actionId]);
            const conflict = conflicts.get(actionId);
            const conflictDescriptionId = conflict ? `shortcuts-conflict-${actionId}` : undefined;
            const describedBy = ['shortcuts-keybindings-description', conflictDescriptionId]
              .filter((id): id is string => typeof id === 'string')
              .join(' ');
            return (
              <div
                className="grid items-start gap-2 rounded border border-border px-3 py-2 sm:grid-cols-[1fr_auto]"
                key={actionId}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{ACTION_LABELS[actionId]}</span>
                  <span className="font-mono text-xs text-muted">{actionId}</span>
                  {conflict ? (
                    <p
                      className="mt-1 text-xs leading-5 text-warning"
                      id={conflictDescriptionId}
                      role="alert"
                    >
                      {formatConflictMessage(conflict)}
                    </p>
                  ) : null}
                </div>
                <AcceleratorPicker
                  ariaLabel={`${ACTION_LABELS[actionId]} keybinding`}
                  ariaDescribedBy={describedBy}
                  disabled={isExplicitlyUnbound}
                  onChange={(nextAccelerator) => {
                    updateKeybinding(actionId, nextAccelerator);
                  }}
                  value={value}
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
