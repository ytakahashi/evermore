import { SectionPlaceholder } from './SectionPlaceholder';

/**
 * Placeholder for application-level settings until the Cmd+Q confirmation controls are wired.
 */
export function ApplicationSection(): React.JSX.Element {
  return (
    <SectionPlaceholder
      title="Application"
      description="The Cmd+Q quit-confirmation behavior is configured here. The control is coming later; the persisted value is already wired."
      status="Coming soon"
    />
  );
}
