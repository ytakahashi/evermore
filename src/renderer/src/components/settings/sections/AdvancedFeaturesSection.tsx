import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

interface SettingRowProps {
  children: React.ReactNode;
  description: React.ReactNode;
  label: string;
  labelFor?: string;
}

function SettingRow({
  children,
  description,
  label,
  labelFor,
}: SettingRowProps): React.JSX.Element {
  return (
    <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium" htmlFor={labelFor}>
            {label}
          </label>
          <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Live</span>
        </div>
        <div className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</div>
      </div>
      <div className="flex items-center justify-start sm:justify-end">{children}</div>
    </div>
  );
}

/**
 * Renders optional behaviors that affect how Evermore integrates with the user's shell.
 *
 * Currently exposes a single toggle for zsh auto-injection. The renderer never observes the
 * effect directly; the main-process `ShellIntegrationInjector` reads the persisted value and
 * decides per-PTY whether to inject `ZDOTDIR` extras.
 */
export function AdvancedFeaturesSection(): React.JSX.Element {
  const autoInject =
    useSettingsStore((state) => state.settings?.shellIntegration.autoInject) ??
    DEFAULT_APP_SETTINGS.shellIntegration.autoInject;
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Advanced features</h2>
        <p className="mt-1 text-sm text-muted">
          Optional behaviors that affect how Evermore integrates with your shell and external tools.
        </p>
      </header>

      <SettingRow
        label="Automatic shell integration (zsh)"
        labelFor="advanced-features-auto-inject"
        description={
          <>
            <p>
              Automatically inject Evermore&apos;s zsh shell integration for new terminals so the
              sidebar reflects shell-level command lifecycle without editing ~/.zshrc.
            </p>
            <p className="mt-2">
              Takes effect for new panes only. Safe to leave alongside the manual snippet from
              Recommended setup — the auto-injected copy is idempotent and will not double-register.
            </p>
            <p className="mt-2">
              Other shells (bash, fish) and remote shells are not auto-injected. The zsh snippet
              under Recommended setup is only a manual fallback for local zsh.
            </p>
          </>
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            aria-label="Automatic shell integration (zsh)"
            checked={autoInject}
            className="h-4 w-4 accent-brand"
            id="advanced-features-auto-inject"
            onChange={(event) => {
              void updateSettings({
                shellIntegration: { autoInject: event.currentTarget.checked },
              });
            }}
            type="checkbox"
          />
          <span>{autoInject ? 'Enabled' : 'Disabled'}</span>
        </label>
      </SettingRow>
    </div>
  );
}
