import { Plus } from 'lucide-react';
import { formatAgentActivityDetail } from '../../../../shared/agent-label';
import {
  DEFAULT_KEYBINDINGS,
  formatAcceleratorForDisplay,
} from '../../../../shared/keyboard-shortcuts';
import { shortenHomePath } from '../../../../shared/path-label';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { getPaneRunningIndicator } from '../common/pane-running-indicator';
import { SparklesIcon } from '../common/SparklesIcon';
import { AgentTerminalPanel } from './AgentTerminalPanel';
import { OPEN_IN_WORKSPACE_HINT } from './open-in-workspace-shortcut';
import { useAgentsNavigation } from './useAgentsNavigation';
import {
  formatAgentCwdLabel,
  getAgentSessionName,
  groupAgentSessions,
  type AgentSession,
} from './agent-sessions';

interface AgentCardProps {
  session: AgentSession;
  /** Index into the rendered list; only used to keep SVG gradient ids unique. */
  cardIndex: number;
  /** Location within the workspace; `null` when the pane sits at the project root. */
  cwdLabel: string | null;
  onSelect: () => void;
  compact: boolean;
  selected: boolean;
}

function AgentCard({
  session,
  cardIndex,
  cwdLabel,
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
      data-agent-pane-id={session.paneId}
      className={`flex w-full rounded-lg border px-4 py-3 text-left hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${compact ? 'flex-col gap-2' : 'gap-4'} ${selected ? 'border-border-strong bg-raised hover:bg-raised' : 'border-border bg-panel hover:bg-raised/50'}`}
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
          {/* The workspace is named by the section heading, so the card only locates the pane
              within it. The cwd is cut at the end by CSS rather than by segments: an ellipsis
              prefix would hide whether the label is relative or starts with `/` or `~`. */}
          <span className="truncate">{session.tabName}</span>
          {!compact && cwdLabel !== null && (
            <span className="truncate font-mono text-[11px]" title={session.cwd}>
              {cwdLabel}
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
  // An empty string means the user explicitly unbound the action, so the hint is dropped.
  const toggleAgentsHint = formatAcceleratorForDisplay(
    useSettingsStore(
      (state) =>
        state.settings?.shortcuts.keybindings['ui.openAgents'] ??
        DEFAULT_KEYBINDINGS['ui.openAgents'],
    ),
  );
  const {
    sessions,
    selectedPaneId,
    selectedSession,
    listRef,
    viewRef,
    handleFocusCapture,
    handleBlurCapture,
    handleListKeyDown,
    toggleSelection,
    closeSelection,
    openWorkspace,
  } = useAgentsNavigation();
  const groups = groupAgentSessions(sessions);
  // Cards are indexed by flat order so SVG gradient ids stay unique across groups.
  const cardIndexByPaneId = new Map(sessions.map((session, index) => [session.paneId, index]));
  // Relies on the main-process store syncing home's rootPath to the current home directory on
  // every load, which avoids exposing the home directory through preload.
  const homeDirectory = workspaces.find((workspace) => workspace.kind === 'home')?.rootPath;

  return (
    <section
      ref={viewRef}
      aria-label="Agents"
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      className="flex h-full min-h-0 w-full flex-col bg-background text-foreground"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Agents</h1>
          <button
            type="button"
            aria-label="Launch agent"
            className="rounded p-1 text-muted hover:bg-raised hover:text-foreground"
            onClick={() => useUiStore.getState().openLaunchPalette()}
          >
            <Plus size={16} />
          </button>
        </div>
        {/* Modifier chords come first because they also work from the agent terminal, where the
            plain keys belong to the agent. */}
        <p className="text-xs text-muted">
          {toggleAgentsHint && (
            <>
              <kbd>{toggleAgentsHint}</kbd> Back ·{' '}
            </>
          )}
          <kbd>{OPEN_IN_WORKSPACE_HINT}</kbd> Open in workspace · In the list: <kbd>Esc</kbd> Back ·{' '}
          <kbd>↑↓</kbd> Move · <kbd>Space</kbd> Preview · <kbd>Enter</kbd> Open · <kbd>N</kbd> New
        </p>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          ref={listRef}
          tabIndex={-1}
          aria-label="Agent sessions"
          onKeyDown={handleListKeyDown}
          className={`min-h-0 overflow-y-auto p-4 ${selectedSession ? 'w-80 shrink-0' : 'min-w-0 flex-1'}`}
        >
          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const headingId = `agents-group-${group.workspaceId}`;
                return (
                  <section
                    key={group.workspaceId}
                    aria-labelledby={headingId}
                    className="flex flex-col gap-2"
                  >
                    <h2 id={headingId} className="flex min-w-0 items-baseline gap-2 px-1 text-xs">
                      {/* The name only shrinks once the path has fully collapsed. */}
                      <span className="max-w-full shrink-0 truncate font-semibold text-foreground">
                        {group.workspaceName}
                      </span>
                      {/* Flex layout drops this space visually, but it keeps the heading's
                          accessible name from fusing the name and path into one word. */}{' '}
                      <span
                        className="min-w-0 truncate font-mono text-[11px] text-subtle"
                        title={group.workspaceRootPath}
                      >
                        {shortenHomePath(group.workspaceRootPath, homeDirectory)}
                      </span>
                    </h2>
                    {group.sessions.map((session) => (
                      <AgentCard
                        key={session.paneId}
                        cardIndex={cardIndexByPaneId.get(session.paneId) ?? 0}
                        cwdLabel={formatAgentCwdLabel(
                          session.cwd,
                          session.workspaceKind,
                          session.workspaceRootPath,
                          homeDirectory,
                        )}
                        session={session}
                        compact={!!selectedSession}
                        selected={session.paneId === selectedPaneId}
                        onSelect={() => toggleSelection(session.paneId)}
                      />
                    ))}
                  </section>
                );
              })}
            </div>
          )}
        </div>
        {selectedSession && (
          <AgentTerminalPanel
            key={selectedSession.paneId}
            session={selectedSession}
            onClose={closeSelection}
            onOpenWorkspace={() => openWorkspace(selectedSession)}
          />
        )}
      </div>
    </section>
  );
}
