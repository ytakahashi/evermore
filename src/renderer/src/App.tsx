import { Settings, Terminal, Layout, Folder, ChevronRight, Hash } from 'lucide-react';

export default function App(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      {/* TopBar */}
      <header
        className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-panel px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted">
          <Folder size={12} />
          <span>evermore</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted">
          <div className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            <span>2 running</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex w-60 flex-col border-r border-border bg-panel">
          <div className="flex-1 overflow-y-auto p-2">
            <div className="mb-4">
              <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
                Workspaces
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 rounded-md bg-raised px-2 py-1 text-sm text-foreground">
                  <ChevronRight size={14} className="rotate-90 text-subtle" />
                  <Folder size={14} className="text-brand" />
                  <span>evermore</span>
                </div>
                <div className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted hover:bg-raised/50">
                  <div className="w-3.5" />
                  <Hash size={14} className="text-subtle" />
                  <span>web</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Bottom Nav */}
          <nav className="flex items-center justify-around border-t border-border bg-panel p-1">
            <button className="rounded p-1.5 text-brand bg-raised">
              <Layout size={18} />
            </button>
            <button className="rounded p-1.5 text-muted hover:bg-raised hover:text-foreground">
              <Terminal size={18} />
            </button>
            <button className="rounded p-1.5 text-muted hover:bg-raised hover:text-foreground">
              <Settings size={18} />
            </button>
          </nav>
        </aside>

        {/* Main Area */}
        <main className="flex flex-1 flex-col bg-terminal">
          {/* TabBar (Placeholder) */}
          <div className="flex h-9 items-center border-b border-border bg-panel px-2">
            <div className="flex h-full items-center gap-2 border-r border-border bg-terminal px-3 text-xs">
              <span>zsh</span>
              <button className="text-muted hover:text-foreground">×</button>
            </div>
            <button className="ml-2 text-muted hover:text-foreground">+</button>
          </div>

          {/* Terminal Area (Placeholder) */}
          <div className="flex flex-1 items-center justify-center text-subtle">
            <div className="text-center">
              <div className="mb-2 text-lg font-medium">Terminal Area</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
