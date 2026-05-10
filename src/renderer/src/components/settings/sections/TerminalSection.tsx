import { SectionPlaceholder } from './SectionPlaceholder';

/**
 * Placeholder for terminal behavior settings until the live xterm controls are wired.
 */
export function TerminalSection(): React.JSX.Element {
  return (
    <SectionPlaceholder
      title="Terminal"
      description="Cursor style, cursor blinking, the macOS Option-as-Meta toggle, and copy-on-select live here. The persistence is wired up; the controls themselves are coming next."
      status="Coming soon"
    />
  );
}
