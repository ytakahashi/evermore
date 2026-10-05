import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { getTruncatedPathLabel } from '../../../../shared/path-label';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { terminalHostRegistry } from '../../terminal-host/terminalHostRegistry';
import { getAgentSessionName, type AgentSession } from './agent-sessions';

interface AgentTerminalPanelProps {
  session: AgentSession;
  onClose: () => void;
  onOpenWorkspace: () => void;
}

/** Displays an existing pane's terminal without taking ownership of its xterm or PTY. */
export function AgentTerminalPanel({
  session,
  onClose,
  onOpenWorkspace,
}: AgentTerminalPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const attachHost = useCallback((element: HTMLDivElement | null): void => {
    hostRef.current = element;
    setHost(element);
  }, []);
  const handle = useSyncExternalStore(terminalHostRegistry.subscribe, () =>
    terminalHostRegistry.getHandle(session.paneId),
  );
  const borrowedHost = useSyncExternalStore(terminalHostRegistry.subscribe, () =>
    terminalHostRegistry.getBorrowedHost(),
  );

  // Depend on another borrow blocking us, not our own acquisition. Depending on the raw global
  // snapshot would release and reborrow whenever this effect acquires its own terminal.
  const isBlocked = borrowedHost !== undefined && borrowedHost !== host;
  useLayoutEffect(() => {
    if (!host || !handle || isBlocked) return;
    let release: (() => void) | null = null;
    try {
      release = terminalHostRegistry.borrow(session.paneId, host);
    } catch (error: unknown) {
      // The registry has rolled back the move. Keep this optional display unavailable rather than
      // letting a layout-effect error unmount terminal owners and dispose every workspace PTY.
      console.warn(`Failed to borrow terminal for pane ${session.paneId}`, error);
    }
    // Layout cleanup returns the root before the newly revealed workspace can paint.
    return () => {
      try {
        release?.();
      } catch (error: unknown) {
        // Release already cleared the lease and restored the root; a failed fit must not turn a
        // view departure into a React root teardown. The home observer can refit on reveal.
        console.warn(`Failed to return terminal for pane ${session.paneId}`, error);
      }
    };
  }, [handle, host, isBlocked, session.paneId]);

  const isBorrowedHere = host !== null && borrowedHost === host;
  useResizeObserver(hostRef, () => {
    if (isBorrowedHere) handle?.fit();
  });

  return (
    <section
      aria-label="Selected agent terminal"
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{`${getAgentSessionName(session)} · ${session.workspaceName} / ${session.tabName}`}</p>
          <p className="truncate font-mono text-xs text-muted" title={session.cwd}>
            {getTruncatedPathLabel(session.cwd)}
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-xs hover:bg-raised"
          onClick={onOpenWorkspace}
        >
          Open in workspace
        </button>
        <button
          type="button"
          aria-label="Close agent terminal"
          className="rounded p-1 text-muted hover:bg-raised"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-terminal">
        {/* React owns the host, while xterm alone owns everything appended inside it. */}
        <div ref={attachHost} className="absolute inset-2 overflow-hidden" />
        {!isBorrowedHere && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center p-4 text-sm text-muted"
          >
            Terminal is unavailable. Open it in the workspace to continue.
          </p>
        )}
      </div>
    </section>
  );
}
