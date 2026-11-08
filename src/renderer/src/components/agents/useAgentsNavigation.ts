import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { selectIsPaletteOpen, useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { collectAgentSessions, type AgentSession } from './agent-sessions';
import { isOpenInWorkspaceChord } from './open-in-workspace-shortcut';

interface AgentsNavigation {
  sessions: AgentSession[];
  selectedPaneId: string | null;
  selectedSession: AgentSession | undefined;
  listRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<HTMLElement | null>;
  handleFocusCapture: (event: React.FocusEvent<HTMLElement>) => void;
  handleBlurCapture: (event: React.FocusEvent<HTMLElement>) => void;
  handleListKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  toggleSelection: (paneId: string) => void;
  closeSelection: () => void;
  openWorkspace: (session: AgentSession) => void;
}

/** Owns preview selection, focus recovery, and keyboard navigation for one Agents view visit. */
export function useAgentsNavigation(): AgentsNavigation {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const infosByPtyId = usePaneInfoStore((state) => state.infosByPtyId);
  const selectWorkspacePane = useWorkspaceStore((state) => state.selectWorkspacePane);
  const showWorkspaceView = useUiStore((state) => state.showWorkspaceView);
  const pendingPaneId = useUiStore((state) => state.pendingAgentSelectionPaneId);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement | null>(null);
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const sessions = collectAgentSessions(workspaces, infosByPtyId, {
    retainPaneIds: [selectedPaneId, pendingPaneId].filter((id): id is string => id !== null),
  });
  const pendingSession = sessions.find((session) => session.paneId === pendingPaneId);
  const selectedSession = sessions.find((session) => session.paneId === selectedPaneId);

  // Reset against the structural model, not polling: ended agents remain usable shells.
  // Adopt a ready launch request before paint, then consume the external handoff after commit.
  if (pendingSession && pendingSession.paneId !== selectedPaneId)
    setSelectedPaneId(pendingSession.paneId);
  else if (selectedPaneId && !selectedSession) setSelectedPaneId(null);

  useLayoutEffect(() => {
    listRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!pendingPaneId) return;
    const exists = workspaces.some(
      (workspace) => workspace.isOpen && workspace.panes.some((pane) => pane.id === pendingPaneId),
    );
    if (pendingSession || !exists) useUiStore.getState().consumeAgentSelection(pendingPaneId);
  }, [pendingPaneId, pendingSession, workspaces]);

  const focusCard = (paneId: string): void => {
    const card = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-agent-pane-id]') ?? [],
    ).find((element) => element.dataset.agentPaneId === paneId);
    card?.focus({ preventScroll: true });
    card?.scrollIntoView({ block: 'nearest' });
  };

  useLayoutEffect(() => {
    // Removing even an unselected, Tab-focused card must not strand focus on the body.
    if (
      focusedElementRef.current &&
      !viewRef.current?.contains(focusedElementRef.current) &&
      document.activeElement === document.body
    ) {
      listRef.current?.focus();
    }
  });

  const openWorkspace = (session: AgentSession): void => {
    // Layout cleanup returns xterm before the selected workspace paints.
    selectWorkspacePane(session.workspaceId, session.tabId, session.paneId);
    showWorkspaceView();
  };

  // Cmd+Enter opens a session from anywhere in the view, including the borrowed agent terminal,
  // where a plain Enter submits agent input. It is view-local rather than a menu accelerator so
  // the workspace view keeps Cmd+Enter free.
  const openWorkspaceFromShortcut = (event: KeyboardEvent): void => {
    const focusedCard =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>('[data-agent-pane-id]')
        : null;
    const paneId = focusedCard?.dataset.agentPaneId ?? selectedPaneId;
    const session = sessions.find((candidate) => candidate.paneId === paneId);
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    openWorkspace(session);
  };

  // View-level chords must work from the borrowed terminal too. The window capture phase runs
  // before xterm's textarea handler, and stopping propagation keeps xterm from also writing the
  // key to the agent's PTY. Capture sees keys from the whole window, so events originating outside
  // the view (e.g. a sidebar rename input) are left alone.
  // Being view-local, these chords are outside the Shortcuts settings conflict check: if the user
  // binds the same chord to a menu action, the menu accelerator shadows it without any warning.
  const windowKeyDownRef = useRef<(event: KeyboardEvent) => void>(() => {});
  const handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      !(event.target instanceof Node) ||
      !viewRef.current?.contains(event.target) ||
      // Modal pickers own the keyboard; acting behind one would leave it open over the result.
      selectIsPaletteOpen(useUiStore.getState())
    )
      return;
    if (isOpenInWorkspaceChord(event)) openWorkspaceFromShortcut(event);
  };
  // The listener is registered once and reads the latest render's sessions through the ref.
  useLayoutEffect(() => {
    windowKeyDownRef.current = handleWindowKeyDown;
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => windowKeyDownRef.current(event);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      !(event.target instanceof HTMLElement)
    )
      return;

    // Only the list itself and its cards participate; empty-state buttons retain native keys.
    const card = event.target.closest<HTMLButtonElement>('button[data-agent-pane-id]');
    if (
      event.target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      )
    )
      return;
    if (!card && event.target !== event.currentTarget) return;
    const paneId = card?.dataset.agentPaneId ?? selectedPaneId;

    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      useUiStore.getState().openLaunchPalette();
    } else if (event.key === 'Enter') {
      const session = sessions.find((candidate) => candidate.paneId === paneId);
      if (!session) return;
      // Enter normally clicks the button, which would also toggle selection after navigation.
      event.preventDefault();
      openWorkspace(session);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (sessions.length === 0) return;
      event.preventDefault();
      // Arrows move focus only; Space (the native button click) opens the terminal panel.
      // Selecting on every arrow would borrow each passed terminal, refitting and resizing its
      // PTY so every agent TUI redraws, and would collapse the full-width prompts into compact rows.
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const index = sessions.findIndex((session) => session.paneId === paneId);
      const nextIndex =
        index < 0
          ? step > 0
            ? 0
            : sessions.length - 1
          : Math.max(0, Math.min(sessions.length - 1, index + step));
      focusCard(sessions[nextIndex].paneId);
    }
  };

  const closeSelection = (): void => {
    setSelectedPaneId(null);
    // The close button itself is about to unmount, so give focus a durable destination.
    listRef.current?.focus();
  };

  const toggleSelection = (paneId: string): void => {
    if (paneId === selectedPaneId) closeSelection();
    else setSelectedPaneId(paneId);
  };

  const handleFocusCapture = (event: React.FocusEvent<HTMLElement>): void => {
    focusedElementRef.current = event.target;
  };

  const handleBlurCapture = (event: React.FocusEvent<HTMLElement>): void => {
    // DOM removal may omit blur or its next target; retain the node until layout cleanup.
    if (event.relatedTarget) focusedElementRef.current = null;
  };

  return {
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
  };
}
