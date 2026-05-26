import { useState } from 'react';
import { X } from 'lucide-react';
import { useUiStore } from '../../stores/uiStore';
import { AboutSection } from './sections/AboutSection';
import { AdvancedFeaturesSection } from './sections/AdvancedFeaturesSection';
import { AIIntegrationSection } from './sections/AIIntegrationSection';
import { ApplicationSection } from './sections/ApplicationSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { PaneInfoSection } from './sections/PaneInfoSection';
import { RecommendedSetupSection } from './sections/RecommendedSetupSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { TerminalSection } from './sections/TerminalSection';

type SettingsSectionId =
  | 'terminal'
  | 'paneInfo'
  | 'shortcuts'
  | 'application'
  | 'recommendedSetup'
  | 'aiIntegration'
  | 'notifications'
  | 'advancedFeatures'
  | 'about';

interface SectionDefinition {
  id: SettingsSectionId;
  label: string;
  Component: () => React.JSX.Element;
}

const SECTIONS: readonly SectionDefinition[] = [
  { id: 'terminal', label: 'Terminal', Component: TerminalSection },
  { id: 'paneInfo', label: 'Pane info', Component: PaneInfoSection },
  { id: 'shortcuts', label: 'Shortcuts', Component: ShortcutsSection },
  { id: 'application', label: 'Application', Component: ApplicationSection },
  { id: 'recommendedSetup', label: 'Recommended setup', Component: RecommendedSetupSection },
  { id: 'aiIntegration', label: 'AI Integration', Component: AIIntegrationSection },
  { id: 'notifications', label: 'Notifications', Component: NotificationsSection },
  { id: 'advancedFeatures', label: 'Advanced features', Component: AdvancedFeaturesSection },
  { id: 'about', label: 'About', Component: AboutSection },
];

/**
 * Settings panel rendered in the main pane area when `activeView === 'settings'`.
 *
 * Currently only the panel shell, the section navigation, and the About section are wired up; the
 * remaining sections render placeholder copy until their controls are added. The visibility of the
 * panel is owned by `AppShell` (display:none toggle), so this component does not gate its own
 * rendering on `activeView`.
 */
export function SettingsView(): React.JSX.Element {
  const closeSettings = useUiStore((state) => state.closeSettings);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('terminal');
  const ActiveComponent =
    SECTIONS.find((section) => section.id === activeSection)?.Component ?? TerminalSection;

  return (
    <section
      aria-label="Settings"
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">Settings</h1>
        <button
          aria-label="Close settings"
          className="rounded p-1.5 text-muted hover:bg-raised hover:text-foreground"
          onClick={() => {
            closeSettings();
          }}
          type="button"
        >
          <X size={16} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Settings sections"
          className="w-44 flex-shrink-0 border-r border-border bg-panel p-2"
        >
          <ul className="flex flex-col gap-1">
            {SECTIONS.map((section) => {
              const isActive = section.id === activeSection;
              return (
                <li key={section.id}>
                  <button
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      isActive
                        ? 'w-full rounded bg-raised px-2 py-1 text-left text-sm text-brand'
                        : 'w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-raised hover:text-foreground'
                    }
                    onClick={() => {
                      setActiveSection(section.id);
                    }}
                    type="button"
                  >
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <ActiveComponent />
        </div>
      </div>
    </section>
  );
}
