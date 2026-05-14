import type { AppSettings, FontWeight } from '../../../../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

type CursorStyle = AppSettings['terminal']['cursorStyle'];

interface SettingRowProps {
  children: React.ReactNode;
  description: string;
  label: string;
}

function SettingRow({
  children,
  description,
  label,
  labelFor,
}: SettingRowProps & { labelFor?: string }): React.JSX.Element {
  return (
    <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" htmlFor={labelFor}>
            {label}
          </label>
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

const FONT_WEIGHT_OPTIONS: ReadonlyArray<{ label: string; value: FontWeight }> = [
  { label: 'Thin (100)', value: '100' },
  { label: 'Extra Light (200)', value: '200' },
  { label: 'Light (300)', value: '300' },
  { label: 'Regular (400)', value: '400' },
  { label: 'Normal', value: 'normal' },
  { label: 'Medium (500)', value: '500' },
  { label: 'Semi-bold (600)', value: '600' },
  { label: 'Bold (700)', value: '700' },
  { label: 'Bold', value: 'bold' },
  { label: 'Extra Bold (800)', value: '800' },
  { label: 'Black (900)', value: '900' },
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
        description="The font family used for terminal text."
        label="Font family"
        labelFor="terminal-font-family"
      >
        <input
          className="w-full rounded border border-border bg-raised px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none sm:w-64"
          id="terminal-font-family"
          onChange={(event) => {
            updateTerminalSettings({ fontFamily: event.currentTarget.value });
          }}
          type="text"
          value={terminalSettings.fontFamily}
        />
      </SettingRow>

      <SettingRow
        description="The font size in pixels."
        label="Font size"
        labelFor="terminal-font-size"
      >
        <input
          className="w-20 rounded border border-border bg-raised px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
          id="terminal-font-size"
          max={100}
          min={6}
          onChange={(event) => {
            const val = event.currentTarget.valueAsNumber;
            if (Number.isFinite(val) && val >= 6 && val <= 100) {
              updateTerminalSettings({ fontSize: val });
            }
          }}
          type="number"
          value={terminalSettings.fontSize}
        />
      </SettingRow>

      <SettingRow
        description="The weight of normal terminal text."
        label="Font weight"
        labelFor="terminal-font-weight"
      >
        <select
          className="rounded border border-border bg-raised px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
          id="terminal-font-weight"
          onChange={(event) => {
            updateTerminalSettings({ fontWeight: event.currentTarget.value as FontWeight });
          }}
          value={String(terminalSettings.fontWeight)}
        >
          {FONT_WEIGHT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        description="The weight of bold terminal text."
        label="Bold font weight"
        labelFor="terminal-font-weight-bold"
      >
        <select
          className="rounded border border-border bg-raised px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none"
          id="terminal-font-weight-bold"
          onChange={(event) => {
            updateTerminalSettings({ fontWeightBold: event.currentTarget.value as FontWeight });
          }}
          value={String(terminalSettings.fontWeightBold)}
        >
          {FONT_WEIGHT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </SettingRow>

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
