import { MainTerminalArea } from '../main-area/MainTerminalArea';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-foreground">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <MainTerminalArea />
      </div>
    </div>
  );
}
