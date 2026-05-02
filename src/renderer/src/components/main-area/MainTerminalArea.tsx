import { TabBar } from './TabBar';

export function MainTerminalArea(): React.JSX.Element {
  return (
    <main className="flex flex-1 flex-col bg-terminal">
      <TabBar />
      <div className="flex flex-1 items-center justify-center text-subtle">
        <div className="text-lg font-medium">Terminal Area</div>
      </div>
    </main>
  );
}
