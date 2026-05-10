import type { AppSettings } from '../../../../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

type CursorStyle = AppSettings['terminal']['cursorStyle'];

interface SettingRowProps {
  children: React.ReactNode;
  description: string;
  label: string;
}

function SettingRow({ children, description, label }: SettingRowProps): React.JSX.Element {
  return (
    <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{label}</h3>
          <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Live</span>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</p>
      </div>
      <div className="flex items-center justify-start sm:justify-end">{children}</div>
    </div>
  );
}

interface ToggleProps {
  ariaLabel: string;
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

function Toggle({ ariaLabel, checked, label, onChange }: ToggleProps): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        aria-label={ariaLabel}
        checked={checked}
        className="h-4 w-4 accent-brand"
        onChange={(event) => {
          onChange(event.currentTarget.checked);
        }}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

const CURSOR_STYLE_OPTIONS: ReadonlyArray<{ label: string; preview: string; value: CursorStyle }> =
  [
    { label: 'Block', preview: '█', value: 'block' },
    { label: 'Bar', preview: '|', value: 'bar' },
    { label: 'Underline', preview: '_', value: 'underline' },
  ];

/**
 * Renders live terminal behavior controls backed by the persisted settings store.
 */
export function TerminalSection(): React.JSX.Element {
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const terminalSettings = settings?.terminal ?? DEFAULT_APP_SETTINGS.terminal;

  const updateTerminalSettings = (patch: Partial<AppSettings['terminal']>): void => {
    void updateSettings({ terminal: patch });
  };

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Terminal</h2>
        <p className="mt-1 text-sm text-muted">
          These preferences apply to existing terminal panes immediately.
        </p>
      </header>

      <SettingRow
        description="Choose the cursor shape shown inside terminal panes."
        label="Cursor shape"
      >
        <fieldset aria-label="Cursor shape" className="flex flex-wrap gap-2">
          {CURSOR_STYLE_OPTIONS.map((option) => (
            <label
              className={
                terminalSettings.cursorStyle === option.value
                  ? 'flex items-center gap-2 rounded border border-brand bg-raised px-2 py-1 text-sm text-foreground'
                  : 'flex items-center gap-2 rounded border border-border px-2 py-1 text-sm text-muted hover:bg-raised hover:text-foreground'
              }
              key={option.value}
            >
              <input
                checked={terminalSettings.cursorStyle === option.value}
                className="accent-brand"
                name="terminal-cursor-style"
                onChange={() => {
                  updateTerminalSettings({ cursorStyle: option.value });
                }}
                type="radio"
                value={option.value}
              />
              <span className="font-mono text-xs">{option.preview}</span>
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
      </SettingRow>

      <SettingRow
        description="Blink the terminal cursor while the pane is focused."
        label="Cursor blinking"
      >
        <Toggle
          ariaLabel="Cursor blinking"
          checked={terminalSettings.cursorBlink}
          label={terminalSettings.cursorBlink ? 'On' : 'Off'}
          onChange={(checked) => {
            updateTerminalSettings({ cursorBlink: checked });
          }}
        />
      </SettingRow>

      <SettingRow
        description="Send macOS Option key chords as Meta input for readline, Emacs, and shell shortcuts."
        label="Option as Meta"
      >
        <Toggle
          ariaLabel="Option as Meta"
          checked={terminalSettings.macOptionIsMeta}
          label={terminalSettings.macOptionIsMeta ? 'On' : 'Off'}
          onChange={(checked) => {
            updateTerminalSettings({ macOptionIsMeta: checked });
          }}
        />
      </SettingRow>

      <SettingRow
        description="Copy selected terminal text to the clipboard as soon as selection changes."
        label="Copy on select"
      >
        <Toggle
          ariaLabel="Copy on select"
          checked={terminalSettings.copyOnSelect}
          label={terminalSettings.copyOnSelect ? 'On' : 'Off'}
          onChange={(checked) => {
            updateTerminalSettings({ copyOnSelect: checked });
          }}
        />
      </SettingRow>
    </div>
  );
}
