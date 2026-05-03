import '@xterm/xterm/css/xterm.css';

import { useTerminal } from './useTerminal';

interface TerminalViewProps {
  cwd?: string;
  onCwdChange?: (cwd: string) => void;
  shell?: string;
}

/**
 * Renders one terminal pane and lets `useTerminal` own the xterm and PTY lifecycles.
 */
export function TerminalView({
  cwd = '',
  onCwdChange,
  shell,
}: TerminalViewProps): React.JSX.Element {
  const { containerRef } = useTerminal({ cwd, onCwdChange, shell });

  return (
    <div className="h-full min-h-0 w-full bg-terminal p-2">
      <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden" />
    </div>
  );
}
