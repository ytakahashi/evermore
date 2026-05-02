import { Settings, Terminal, Layout } from 'lucide-react';

export function SidebarBottomNav(): React.JSX.Element {
  return (
    <nav className="flex items-center justify-around border-t border-border bg-panel p-1">
      <button aria-label="Workspaces" className="rounded bg-raised p-1.5 text-brand">
        <Layout size={18} />
      </button>
      <button
        aria-label="Connections"
        className="rounded p-1.5 text-muted hover:bg-raised hover:text-foreground"
      >
        <Terminal size={18} />
      </button>
      <button
        aria-label="Settings"
        className="rounded p-1.5 text-muted hover:bg-raised hover:text-foreground"
      >
        <Settings size={18} />
      </button>
    </nav>
  );
}
