import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { selectIsPaletteOpen, useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { collectAgentSessions, resolveAgentCursor, type AgentSession } from './agent-sessions';
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
  handleTerminalFocusCapture: () => void;
  selectPreview: (paneId: string) => void;
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
  const storedCursorPaneId = useUiStore((state) => state.agentCursorPaneId);
  const setAgentCursor = useUiStore((state) => state.setAgentCursor);
  const isPaletteOpen = useUiStore(selectIsPaletteOpen);
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLElement | null>(null);
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const [previousPaneIds, setPreviousPaneIds] = useState<readonly string[]>([]);
  const initializedRef = useRef(false);
  const restoreCursorFocusRef = useRef(false);
  const wasPaletteOpenRef = useRef(false);
  const sessions = collectAgentSessions(workspaces, infosByPtyId, {
    retainPaneIds: [selectedPaneId, pendingPaneId].filter((id): id is string => id !== null),
  });
  const pendingSession = sessions.find((session) => session.paneId === pendingPaneId);
  const selectedSession = sessions.find((session) => session.paneId === selectedPaneId);
  const paneIds = sessions.map((session) => session.paneId);
  const cursorPaneId =
    pendingSession?.paneId ?? resolveAgentCursor(paneIds, previousPaneIds, storedCursorPaneId);

  // Keep the old order until the store accepts a removal fallback; otherwise a render retry
  // would lose the vanished row's index. React state keeps abandoned renders from changing
  // the history used by a later committed render.
  if (
    storedCursorPaneId === cursorPaneId &&
    (previousPaneIds.length !== paneIds.length ||
      previousPaneIds.some((id, index) => id !== paneIds[index]))
  )
    setPreviousPaneIds(paneIds);

  // Reset against the structural model, not polling: ended agents remain usable shells.
  // Adopt a ready launch request before paint, then consume the external handoff after commit.
  if (pendingSession && pendingSession.paneId !== selectedPaneId)
    setSelectedPaneId(pendingSession.paneId);
  else if (selectedPaneId && !selectedSession) setSelectedPaneId(null);

  const focusCard = (paneId: string | null, scroll = false): void => {
    const card = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[data-agent-pane-id]') ?? [],
    ).find((element) => element.dataset.agentPaneId === paneId);
    if (card) {
      card.focus({ preventScroll: true });
      if (scroll) card.scrollIntoView({ block: 'nearest' });
    } else if (sessions.length === 0) {
      listRef.current?.focus();
    }
  };

  useLayoutEffect(() => {
    // The cursor belongs to one visit, even though menu-driven pickers read it from the store.
    return () => {
      initializedRef.current = false;
      setAgentCursor(null);
    };
  }, [setAgentCursor]);

  useLayoutEffect(() => {
    // External stores cannot be updated during render, so publish the resolved cursor at commit.
    if (useUiStore.getState().agentCursorPaneId !== cursorPaneId) setAgentCursor(cursorPaneId);
  });

  useLayoutEffect(() => {
    if (!pendingPaneId) return;
    const exists = workspaces.some(
      (workspace) => workspace.isOpen && workspace.panes.some((pane) => pane.id === pendingPaneId),
    );
    if (pendingSession || !exists) useUiStore.getState().consumeAgentSelection(pendingPaneId);
  }, [pendingPaneId, pendingSession, workspaces]);

  useLayoutEffect(() => {
    // A picker cannot restore focus to a card removed behind it, and moving into the picker has
    // already cleared focusedElementRef. Only the closing transition may claim a body focus, since
    // the body is also where focus rests after a click on non-focusable UI outside the view.
    const paletteClosed = wasPaletteOpenRef.current && !isPaletteOpen;
    wasPaletteOpenRef.current = isPaletteOpen;
    const isFirstFocus = !initializedRef.current;

    // Keyboard focus belongs on the cursor card: on entry, after a preview closes, once a first
    // row replaces the empty list, and when removing a card, even an unselected Tab-focused one,
    // would strand focus on the body.
    if (
      isFirstFocus ||
      restoreCursorFocusRef.current ||
      (document.activeElement === listRef.current && cursorPaneId !== null) ||
      (paletteClosed && document.activeElement === document.body) ||
      (focusedElementRef.current &&
        !viewRef.current?.contains(focusedElementRef.current) &&
        document.activeElement === document.body)
    ) {
      // Closing an ended preview can remove its card too; focus only after that DOM update.
      restoreCursorFocusRef.current = false;
      initializedRef.current = true;
      // The list reflows when a preview closes, which can leave the target outside the viewport.
      focusCard(cursorPaneId, !isFirstFocus);
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
    const paneId = card?.dataset.agentPaneId ?? cursorPaneId;

    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      useUiStore.getState().openLaunchPalette();
    } else if (event.key === ' ') {
      if (!paneId) return;
      // Suppress native button activation so Space toggles while clicks only open previews.
      event.preventDefault();
      // Native activation fired once per press; auto-repeat would churn the terminal borrow.
      if (event.repeat) return;
      if (paneId === selectedPaneId) closeSelection();
      else setSelectedPaneId(paneId);
    } else if (event.key === 'Enter') {
      const session = sessions.find((candidate) => candidate.paneId === paneId);
      if (!session) return;
      // Suppress native activation after navigation.
      event.preventDefault();
      openWorkspace(session);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (sessions.length === 0) return;
      event.preventDefault();
      // Arrows move focus only; Space opens the terminal panel.
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
      focusCard(sessions[nextIndex].paneId, true);
    }
  };

  const closeSelection = (): void => {
    setSelectedPaneId(null);
    restoreCursorFocusRef.current = true;
  };

  const selectPreview = (paneId: string): void => {
    setAgentCursor(paneId);
    setSelectedPaneId(paneId);
    // macOS mouse activation need not focus a button; make the next Space target explicit.
    focusCard(paneId);
  };

  const handleFocusCapture = (event: React.FocusEvent<HTMLElement>): void => {
    focusedElementRef.current = event.target;
    const card = event.target.closest<HTMLElement>('[data-agent-pane-id]');
    if (card?.dataset.agentPaneId) setAgentCursor(card.dataset.agentPaneId);
    else if (event.target === listRef.current && cursorPaneId) focusCard(cursorPaneId);
  };

  const handleTerminalFocusCapture = (): void => {
    if (selectedSession) setAgentCursor(selectedSession.paneId);
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
    selectPreview,
    handleTerminalFocusCapture,
    closeSelection,
    openWorkspace,
  };
}
