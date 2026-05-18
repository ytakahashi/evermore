import '@xterm/xterm/css/xterm.css';

import { useTerminal } from './useTerminal';

interface TerminalViewProps {
  cwd?: string;
  initialCommand?: string;
  isActive?: boolean;
  onPtyIdChange?: (ptyId: string | null) => void;
  shell?: string;
}

/**
 * Renders one terminal pane and lets `useTerminal` own the xterm and PTY lifecycles.
 */
export function TerminalView({
  cwd = '',
  initialCommand,
  isActive = false,
  onPtyIdChange,
  shell,
}: TerminalViewProps): React.JSX.Element {
  const { containerRef } = useTerminal({
    cwd,
    initialCommand,
    isActive,
    onPtyIdChange,
    shell,
  });

  return (
    <div className="relative h-full min-h-0 w-full bg-terminal">
      <div ref={containerRef} className="absolute inset-2 overflow-hidden" />
      <div
        className={`pointer-events-none absolute inset-0 z-10 bg-pane-inactive-overlay transition-opacity duration-200 ${
          isActive ? 'opacity-0' : 'opacity-100'
        }`}
      />
    </div>
  );
}
