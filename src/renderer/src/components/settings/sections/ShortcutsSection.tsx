import { SectionPlaceholder } from './SectionPlaceholder';

/**
 * Placeholder for shortcut settings until the global hotkey and keybinding controls are wired.
 */
export function ShortcutsSection(): React.JSX.Element {
  return (
    <SectionPlaceholder
      title="Shortcuts"
      description="The global activate-window hotkey and the per-action keybinding table are coming later. The underlying values are persisted now but not yet bound."
      status="Coming soon"
    />
  );
}
