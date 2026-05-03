import { TabBar } from './TabBar';
import { TerminalView } from '../terminal/TerminalView';

export function MainTerminalArea(): React.JSX.Element {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-terminal">
      <TabBar />
      <div className="min-h-0 flex-1">
        <TerminalView />
      </div>
    </main>
  );
}
