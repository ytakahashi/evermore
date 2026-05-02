export function TabBar(): React.JSX.Element {
  return (
    <div className="flex h-9 items-center border-b border-border bg-panel px-2">
      <div className="flex h-full items-center gap-2 border-r border-border bg-terminal px-3 text-xs">
        <span>zsh</span>
        <button className="text-muted hover:text-foreground">×</button>
      </div>
      <button className="ml-2 text-muted hover:text-foreground">+</button>
    </div>
  );
}
