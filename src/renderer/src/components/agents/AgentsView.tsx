import { formatAgentActivityDetail } from '../../../../shared/agent-label';
import { formatAgentDisplayName } from '../../../../shared/ai-integration/agent-display-name';
import { getTruncatedPathLabel } from '../../../../shared/path-label';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { getPaneRunningIndicator } from '../common/pane-running-indicator';
import { SparklesIcon } from '../common/SparklesIcon';
import { collectAgentSessions, type AgentSession } from './agent-sessions';

interface AgentCardProps {
  session: AgentSession;
  /** Index into the rendered list; only used to keep SVG gradient ids unique. */
  cardIndex: number;
  onSelect: () => void;
}

function AgentCard({ session, cardIndex, onSelect }: AgentCardProps): React.JSX.Element {
  const { info } = session;
  const name = formatAgentDisplayName(info.agent);
  const summary = info.agent ? formatAgentActivityDetail(info.agent) : undefined;
  // Reused from the sidebar so one pane can never read as two different states depending on which
  // surface the user is looking at.
  const indicator = getPaneRunningIndicator(info);

  return (
    <button
      className="flex w-full gap-4 rounded-lg border border-border bg-panel px-4 py-3 text-left hover:border-border-strong hover:bg-raised/50"
      type="button"
      onClick={onSelect}
    >
      {/* Identity column, fixed-width so agent names and locations line up down the list and the
          eye can scan one column instead of re-finding it on every row. */}
      <div className="flex w-56 shrink-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <SparklesIcon agent={info.agent?.known} paneIndex={cardIndex} size={16} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
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
          <span className="truncate font-mono text-[11px]" title={session.cwd}>
            {getTruncatedPathLabel(session.cwd)}
          </span>
        </div>
      </div>

      {/* Content column takes the rest of the width — this pairing is what the sidebar cannot show,
          so it gets the space. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {info.userPrompt ? (
          <p
            className="line-clamp-3 text-sm leading-relaxed text-foreground"
            title={info.userPrompt}
          >{`❝ ${info.userPrompt}`}</p>
        ) : (
          <p className="text-sm text-subtle italic">No prompt captured for this session</p>
        )}
        {summary && (
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
 * Agent overview rendered in the main pane area when `activeView === 'agents'`.
 *
 * Puts each running agent's activity summary next to the prompt that started it, which is the pair
 * the sidebar cannot show side by side at its width. Visibility is owned by `AppShell` (a
 * `display:none` toggle), so this component does not gate its own rendering on `activeView`.
 *
 * Sessions are stacked as full-width rows rather than tiled into a grid. Tiling divides the width
 * among however many agents happen to be running, so the prompt — the longest and most valuable
 * field, and the one thing this view exists to show — gets squeezed hardest exactly when the most
 * sessions are in flight. A row gives every prompt the full width and costs only vertical space,
 * which this view has to spare.
 */
export function AgentsView(): React.JSX.Element {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const infosByPtyId = usePaneInfoStore((state) => state.infosByPtyId);
  const selectWorkspacePane = useWorkspaceStore((state) => state.selectWorkspacePane);
  const showWorkspaceView = useUiStore((state) => state.showWorkspaceView);

  const sessions = collectAgentSessions(workspaces, infosByPtyId);

  return (
    <section
      aria-label="Agents"
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">Agents</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {sessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((session, cardIndex) => (
              <AgentCard
                key={session.paneId}
                cardIndex={cardIndex}
                session={session}
                onSelect={() => {
                  // selectWorkspacePane already switches the active workspace when the target lives
                  // in another one, so no separate setActiveWorkspace call is needed here.
                  selectWorkspacePane(session.workspaceId, session.tabId, session.paneId);
                  showWorkspaceView();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
