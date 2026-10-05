import { useLayoutEffect, useRef, useState } from 'react';
import { formatAgentActivityDetail } from '../../../../shared/agent-label';
import { getTruncatedPathLabel } from '../../../../shared/path-label';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { getPaneRunningIndicator } from '../common/pane-running-indicator';
import { SparklesIcon } from '../common/SparklesIcon';
import { AgentTerminalPanel } from './AgentTerminalPanel';
import { collectAgentSessions, getAgentSessionName, type AgentSession } from './agent-sessions';

interface AgentCardProps {
  session: AgentSession;
  /** Index into the rendered list; only used to keep SVG gradient ids unique. */
  cardIndex: number;
  onSelect: () => void;
  compact: boolean;
  selected: boolean;
}

function AgentCard({
  session,
  cardIndex,
  onSelect,
  compact,
  selected,
}: AgentCardProps): React.JSX.Element {
  const { info } = session;
  const name = getAgentSessionName(session);
  const summary = info?.agent ? formatAgentActivityDetail(info.agent) : undefined;
  // Reused from the sidebar so one pane can never read as two different states depending on which
  // surface the user is looking at.
  const indicator = info?.agent ? getPaneRunningIndicator(info) : null;

  return (
    <button
      aria-pressed={selected}
      className={`flex w-full rounded-lg border px-4 py-3 text-left hover:border-border-strong ${compact ? 'flex-col gap-2' : 'gap-4'} ${selected ? 'border-border-strong bg-raised hover:bg-raised' : 'border-border bg-panel hover:bg-raised/50'}`}
      type="button"
      onClick={onSelect}
    >
      {/* Identity column, fixed-width so agent names and locations line up down the list and the
          eye can scan one column instead of re-finding it on every row. */}
      <div className={`flex shrink-0 flex-col gap-1.5 ${compact ? 'w-full min-w-0' : 'w-56'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <SparklesIcon agent={info?.agent?.known} paneIndex={cardIndex} size={16} />
          <span
            className={`min-w-0 flex-1 truncate text-sm font-medium ${info?.agent ? 'text-foreground' : 'text-muted'}`}
          >
            {name}
          </span>
        </div>
        {indicator && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={indicator.className} />
            <span className="text-xs text-muted">{indicator.label}</span>
          </span>
        )}
        <div className="mt-0.5 flex min-w-0 flex-col gap-0.5 text-xs text-muted">
          <span className="truncate">{`${session.workspaceName} / ${session.tabName}`}</span>
          {!compact && (
            <span className="truncate font-mono text-[11px]" title={session.cwd}>
              {getTruncatedPathLabel(session.cwd)}
            </span>
          )}
        </div>
      </div>

      {/* Content column takes the rest of the width — this pairing is what the sidebar cannot show,
          so it gets the space. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {info?.userPrompt ? (
          // `whitespace-pre-line` keeps the line breaks the prompt was written with, so lists and
          // step-by-step instructions stay legible. The sidebar deliberately does not opt in: its
          // rows are single-line, where a break renders as a space.
          <p
            className={`${compact ? 'line-clamp-2' : 'line-clamp-3'} text-sm leading-relaxed whitespace-pre-line text-foreground`}
            title={info.userPrompt}
          >{`❝ ${info.userPrompt}`}</p>
        ) : (
          <p className="text-sm text-subtle italic">No prompt captured for this session</p>
        )}
        {!compact && summary && (
          <p
            className="line-clamp-2 border-t border-border pt-2 text-xs text-muted"
            title={summary}
          >
            {summary}
          </p>
        )}
      </div>
    </button>
  );
}

function EmptyState(): React.JSX.Element {
  const openSettings = useUiStore((state) => state.openSettings);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-muted">No agents detected</p>
      <p className="max-w-md text-xs text-subtle">
        Panes appear here once an AI agent is running in them. Agents report what they are working
        on through hooks, which have to be configured once per CLI.
      </p>
      <button
        className="rounded border border-border px-3 py-1.5 text-xs text-foreground hover:bg-raised"
        type="button"
        onClick={() => {
          openSettings();
        }}
      >
        Open AI Integration settings
      </button>
    </div>
  );
}

/**
 * Renders the agent overview for one visit, unmounting its contents on departure to discard
 * selection and return any borrowed terminal. Workspace terminal owners stay mounted in AppShell.
 *
 * Unselected sessions use full-width rows rather than a grid: prompts are the longest and most
 * valuable field, and tiles would squeeze them hardest when more agents are running. Rows preserve
 * prompt width at the cost of vertical space. Only selecting a session narrows the list to make
 * room for its terminal alongside it.
 */
export function AgentsView(): React.JSX.Element {
  const activeView = useUiStore((state) => state.activeView);
  return activeView === 'agents' ? <AgentSessionsView /> : <></>;
}

/** Full-width prompts remain readable until the user opens one terminal alongside the list. */
function AgentSessionsView(): React.JSX.Element {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const infosByPtyId = usePaneInfoStore((state) => state.infosByPtyId);
  const selectWorkspacePane = useWorkspaceStore((state) => state.selectWorkspacePane);
  const showWorkspaceView = useUiStore((state) => state.showWorkspaceView);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previousSelectionRef = useRef<string | null>(null);
  const sessions = collectAgentSessions(workspaces, infosByPtyId, {
    retainPaneId: selectedPaneId ?? undefined,
  });
  const selectedSession = sessions.find((session) => session.paneId === selectedPaneId);

  // Reset against the structural model, not polling: ended agents remain usable shells.
  if (selectedPaneId && !selectedSession) setSelectedPaneId(null);

  useLayoutEffect(() => {
    // A retained ended-agent row disappears on deselection. Keep keyboard focus in the list
    // when that removal (or a pane close) would otherwise leave it on the document body.
    if (
      previousSelectionRef.current &&
      !selectedPaneId &&
      document.activeElement === document.body
    ) {
      listRef.current?.focus();
    }
    previousSelectionRef.current = selectedPaneId;
  }, [selectedPaneId]);

  const closeSelection = (): void => {
    setSelectedPaneId(null);
    // The close button itself is about to unmount, so give focus a durable destination.
    listRef.current?.focus();
  };

  return (
    <section
      aria-label="Agents"
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">Agents</h1>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          ref={listRef}
          tabIndex={-1}
          aria-label="Agent sessions"
          className={`min-h-0 overflow-y-auto p-4 ${selectedSession ? 'w-80 shrink-0' : 'min-w-0 flex-1'}`}
        >
          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-2">
              {sessions.map((session, cardIndex) => (
                <AgentCard
                  key={session.paneId}
                  cardIndex={cardIndex}
                  session={session}
                  compact={!!selectedSession}
                  selected={session.paneId === selectedPaneId}
                  onSelect={() => {
                    if (session.paneId === selectedPaneId) closeSelection();
                    else setSelectedPaneId(session.paneId);
                  }}
                />
              ))}
            </div>
          )}
        </div>
        {selectedSession && (
          <AgentTerminalPanel
            key={selectedSession.paneId}
            session={selectedSession}
            onClose={closeSelection}
            onOpenWorkspace={() => {
              // Selecting resolves the latest workspace/tab location; layout cleanup returns xterm
              // in the same commit as the workspace reveal, before paint.
              selectWorkspacePane(
                selectedSession.workspaceId,
                selectedSession.tabId,
                selectedSession.paneId,
              );
              showWorkspaceView();
            }}
          />
        )}
      </div>
    </section>
  );
}
