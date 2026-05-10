import type { AppSettings } from '../../../../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

const QUIT_CONFIRM_OPTIONS: ReadonlyArray<{
  description: string;
  label: string;
  value: AppSettings['app']['quitConfirm'];
}> = [
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
    description: 'Ask only when pane activity shows a running process.',
    label: 'When processes are running',
    value: 'running-only',
  },
];

/**
 * Renders application-level behavior settings.
 */
export function ApplicationSection(): React.JSX.Element {
  const quitConfirm =
    useSettingsStore((state) => state.settings?.app.quitConfirm) ??
    DEFAULT_APP_SETTINGS.app.quitConfirm;
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Application</h2>
      </header>

      <fieldset className="border-b border-border-subtle py-4">
        <div className="flex items-center gap-2">
          <legend className="text-sm font-medium">Quit confirmation</legend>
          <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Live</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {QUIT_CONFIRM_OPTIONS.map((option) => (
            <label
              className={
                quitConfirm === option.value
                  ? 'rounded border border-brand bg-raised px-3 py-2 text-sm'
                  : 'rounded border border-border px-3 py-2 text-sm text-muted hover:bg-raised hover:text-foreground'
              }
              key={option.value}
            >
              <span className="flex items-start gap-2">
                <input
                  checked={quitConfirm === option.value}
                  className="mt-0.5 accent-brand"
                  name="quit-confirm"
                  onChange={() => {
                    void updateSettings({ app: { quitConfirm: option.value } });
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
    </div>
  );
}
