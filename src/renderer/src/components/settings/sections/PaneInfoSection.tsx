import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

/**
 * Renders live pane activity polling settings.
 */
export function PaneInfoSection(): React.JSX.Element {
  const pollIntervalMs =
    useSettingsStore((state) => state.settings?.paneInfo.pollIntervalMs) ??
    DEFAULT_APP_SETTINGS.paneInfo.pollIntervalMs;
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Pane info</h2>
        <p className="mt-1 text-sm text-muted">
          Controls how often Evermore checks terminal process activity for sidebar status.
        </p>
      </header>

      <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_10rem]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Process poll interval</h3>
            <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">Live</span>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Lower values refresh running-command and activity status sooner, but each poll spawns a
            ps subprocess in the main process. With many panes open, very low values can increase
            CPU usage. Set 0 or less to disable recurring polling.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm sm:justify-end">
          <input
            className="w-28 rounded border border-border bg-background px-2 py-1 text-right font-mono text-sm"
            onChange={(event) => {
              const nextValue = Number(event.currentTarget.value);
              if (Number.isFinite(nextValue)) {
                void updateSettings({ paneInfo: { pollIntervalMs: nextValue } });
              }
            }}
            step={250}
            type="number"
            value={pollIntervalMs}
          />
          <span className="text-xs text-muted">ms</span>
        </label>
      </div>
    </div>
  );
}
