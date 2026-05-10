interface SectionPlaceholderProps {
  title: string;
  description: string;
  /**
   * Short status label rendered as a small badge next to the title (e.g. "For now", "Coming
   * soon"). Lets each section advertise that the controls are not yet wired up without the user
   * having to read the description.
   */
  status: string;
}

/**
 * Renders a "(coming later)" stub for SettingsView sections that have not been wired up yet.
 *
 * Used so the section navigation already shows the final shape; later edits replace each
 * placeholder with the real form. Keeping this neutral (no fake controls) avoids leading users to
 * believe a setting works when it does not.
 */
export function SectionPlaceholder({
  title,
  description,
  status,
}: SectionPlaceholderProps): React.JSX.Element {
  return (
    <div>
      <header className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="rounded bg-raised px-1.5 py-0.5 text-xs text-muted">{status}</span>
      </header>
      <p className="text-sm text-muted">{description}</p>
    </div>
  );
}
