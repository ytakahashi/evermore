import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';

/**
 * Renders user-facing notification preferences.
 *
 * The section is intentionally kept independent of the AI Integration section: the notification
 * surface is a general-purpose macOS notification path that AI awaiting-input happens to be the
 * first consumer of. Future toggles (e.g. tunnel errors, long-running commands) will land here too.
 */
export function NotificationsSection(): React.JSX.Element {
  const aiAgentAwaitingInputEnabled =
    useSettingsStore((state) => state.settings?.notifications.aiAgentAwaitingInputEnabled) ??
    DEFAULT_APP_SETTINGS.notifications.aiAgentAwaitingInputEnabled;
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted">
          Control which Evermore events raise a macOS notification.
        </p>
      </header>

      <div className="grid gap-3 border-b border-border-subtle py-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <label className="text-sm font-medium" htmlFor="notifications-ai-awaiting-input">
            Notify when an AI agent is waiting for input
          </label>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            Sends a macOS notification when a tracked AI agent enables its awaiting-input state.
            Requires the agent&apos;s hook to be configured and the agent to expose an
            awaiting-input signal — see Settings &gt; AI Integration.
          </p>
        </div>
        <div className="flex items-center justify-start sm:justify-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              aria-label="Notify when an AI agent is waiting for input"
              checked={aiAgentAwaitingInputEnabled}
              className="h-4 w-4 accent-brand"
              id="notifications-ai-awaiting-input"
              onChange={(event) => {
                void updateSettings({
                  notifications: { aiAgentAwaitingInputEnabled: event.currentTarget.checked },
                });
              }}
              type="checkbox"
            />
            <span>{aiAgentAwaitingInputEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
