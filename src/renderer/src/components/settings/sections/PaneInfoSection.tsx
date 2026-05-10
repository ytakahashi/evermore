import { SectionPlaceholder } from './SectionPlaceholder';

/**
 * Placeholder for pane activity polling settings until the live poll interval control is wired.
 */
export function PaneInfoSection(): React.JSX.Element {
  return (
    <SectionPlaceholder
      title="Pane info"
      description="Controls the polling interval used to read pane activity (running command, idle/active dot). The control is coming later."
      status="Coming soon"
    />
  );
}
