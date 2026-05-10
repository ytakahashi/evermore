import { SectionPlaceholder } from './SectionPlaceholder';

export function PaneInfoSection(): React.JSX.Element {
  return (
    <SectionPlaceholder
      title="Pane info"
      description="Controls the polling interval used to read pane activity (running command, idle/active dot). The control is coming later."
      status="Coming soon"
    />
  );
}
