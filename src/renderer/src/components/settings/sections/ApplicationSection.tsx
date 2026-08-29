import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import type { ConfirmMode } from '../../../../../shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';

interface ConfirmModeOption {
  description: string;
  label: string;
  value: ConfirmMode;
}

const QUIT_CONFIRM_OPTIONS: readonly ConfirmModeOption[] = [
  {
    description: 'Quit immediately without a confirmation dialog.',
    label: 'Never',
    value: 'never',
  },
  {
    description: 'Always ask before quitting Evermore.',
    label: 'Always',
    value: 'always',
  },
  {
    description: 'Ask when a terminal process or SSH tunnel is active.',
    label: 'When processes are running',
    value: 'running-only',
  },
];

const TAB_CLOSE_CONFIRM_OPTIONS: readonly ConfirmModeOption[] = [
  {
    description: 'Close tabs immediately without a confirmation dialog.',
    label: 'Never',
    value: 'never',
  },
  {
    description: 'Always ask before closing a tab.',
    label: 'Always',
    value: 'always',
  },
  {
    description: 'Ask when a terminal process is running in the tab.',
    label: 'When processes are running',
    value: 'running-only',
  },
];

function ConfirmModeFieldset(props: {
  legend: string;
  name: string;
  onChange: (value: ConfirmMode) => void;
  options: readonly ConfirmModeOption[];
  value: ConfirmMode;
}): React.JSX.Element {
  return (
    <fieldset className="border-b border-border-subtle py-4">
      <legend className="text-sm font-medium">{props.legend}</legend>
      <div className="mt-3 flex flex-col gap-2">
        {props.options.map((option) => (
          <label
            className={
              props.value === option.value
                ? 'rounded border border-brand bg-raised px-3 py-2 text-sm'
                : 'rounded border border-border px-3 py-2 text-sm text-muted hover:bg-raised hover:text-foreground'
            }
            key={option.value}
          >
            <span className="flex items-start gap-2">
              <input
                checked={props.value === option.value}
                className="mt-0.5 accent-brand"
                name={props.name}
                onChange={() => {
                  props.onChange(option.value);
                }}
                type="radio"
                value={option.value}
              />
              <span>
                <span className="block text-foreground">{option.label}</span>
                <span className="block text-xs leading-5 text-muted">{option.description}</span>
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Renders application-level behavior settings.
 */
export function ApplicationSection(): React.JSX.Element {
  const quitConfirm =
    useSettingsStore((state) => state.settings?.app.quitConfirm) ??
    DEFAULT_APP_SETTINGS.app.quitConfirm;
  const tabCloseConfirm =
    useSettingsStore((state) => state.settings?.app.tabCloseConfirm) ??
    DEFAULT_APP_SETTINGS.app.tabCloseConfirm;
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Application</h2>
      </header>

      <ConfirmModeFieldset
        legend="Quit confirmation"
        name="quit-confirm"
        onChange={(value) => {
          void updateSettings({ app: { quitConfirm: value } });
        }}
        options={QUIT_CONFIRM_OPTIONS}
        value={quitConfirm}
      />
      <ConfirmModeFieldset
        legend="Tab close confirmation"
        name="tab-close-confirm"
        onChange={(value) => {
          void updateSettings({ app: { tabCloseConfirm: value } });
        }}
        options={TAB_CLOSE_CONFIRM_OPTIONS}
        value={tabCloseConfirm}
      />
    </div>
  );
}
