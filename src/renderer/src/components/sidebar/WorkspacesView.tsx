import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ChevronRight, Folder, Hash, Plus, Terminal, X, Zap } from 'lucide-react';
import { countPaneLeaves, flattenLayout } from '../../../../shared/pane-layout';
import { getPathBasename, getTruncatedPathLabel } from '../../../../shared/path-label';
import type { Pane, PaneRuntimeInfo } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useTabDragStore } from '../../stores/tabDragStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { ContextMenu } from '../common/ContextMenu';
import { hasActionableItem, type ContextMenuItem } from '../common/contextMenuItems';
import {
  resolveDropEdge,
  toInsertIndex,
  toReorderIndex,
  TAB_DND_MIME,
  type DropEdge,
} from '../common/tabDnd';
import { getPaneRunningIndicator } from './pane-running-indicator';
import { SparklesIcon } from './SparklesIcon';

function formatPaneCount(count: number): string {
  return `${count} ${count === 1 ? 'pane' : 'panes'}`;
}

interface PaneSummaryProps {
  info?: PaneRuntimeInfo;
  isActivePane: boolean;
  isActiveTab: boolean;
  onClick: () => void;
  pane: Pane;
  paneIndex: number;
}

function PaneLeadingIcon({
  info,
  isActivePane,
  paneIndex,
}: {
  info?: PaneRuntimeInfo;
  isActivePane: boolean;
  paneIndex: number;
}): React.JSX.Element {
  // Agent takes precedence over SSH: while a known agent is in the foreground, the tracker
  // guarantees foregroundSession is not 'ssh' (the SSH guard suppresses agent detection), so the
  // two cases are mutually exclusive in practice. The order here just makes the precedence
  // explicit if a future change relaxes that invariant.
  if (info?.agent) {
    const animationClass = getAgentIconAnimationClass(info);
    return (
      <span
        aria-label={info.agent.known ? `${info.agent.known} agent` : 'ai agent'}
        className={`mt-0.5 shrink-0 ${animationClass}`}
        title={info.agent.known ?? info.agent.kind ?? 'AI agent'}
      >
        <SparklesIcon agent={info.agent.known} paneIndex={paneIndex} />
      </span>
    );
  }

  if (info?.processActivity === 'running') {
    switch (info.foregroundSession.kind) {
      case 'ssh':
        return (
          <span
            aria-label="ssh session"
            className={`mt-0.5 shrink-0 ${isActivePane ? 'text-yellow-400' : 'text-subtle/70'}`}
            title="SSH session"
          >
            <Zap aria-hidden="true" size={13} />
          </span>
        );

      case 'other':
      case 'none':
        // Defensive inclusion of `none`: running + none should not be emitted by PaneInfoTracker,
        // but falling back to the regular Terminal icon is safest for inconsistent snapshots.
        break;

      default: {
        // Compile-time exhaustiveness; runtime falls through to the default Terminal icon.
        const _exhaustive: never = info.foregroundSession.kind;
        void _exhaustive;
        break;
      }
    }
  }

  return (
    <Terminal
      size={13}
      className={`mt-0.5 shrink-0 ${isActivePane ? 'text-brand' : 'text-subtle/70'}`}
    />
  );
}

function getAgentIconAnimationClass(info: PaneRuntimeInfo): string {
  if (info.attention?.kind === 'awaiting-input' || info.agent?.status === 'awaiting-input') {
    return 'animate-ping';
  }

  if (info.agent?.status === 'running') {
    return 'animate-pulse';
  }

  return '';
}

function PaneSummary({
  info,
  isActivePane,
  isActiveTab,
  onClick,
  pane,
  paneIndex,
}: PaneSummaryProps): React.JSX.Element {
  const isRunning = info?.processActivity === 'running';
  const indicator = getPaneRunningIndicator(info);
  const label =
    isRunning && info?.foregroundCommand
      ? info.foregroundCommand
      : getPathBasename(pane.cwd, { emptyFallback: '(loading)' });
  const cwdLabel = getTruncatedPathLabel(pane.cwd);

  return (
    <div className="pl-6">
      {/*
        A vertical line representing the pane group under a tab.
        The active tab is brighter than inactive tabs but the line for inactive panes
        is still visible to maintain tab structure visibility.
      */}
      <div className={`border-l ${isActiveTab ? 'border-border-strong' : 'border-border'}`}>
        <button
          aria-current={isActivePane ? 'true' : undefined}
          className={`flex w-full min-w-0 items-start gap-1.5 rounded-md pl-3 pr-2 py-1 text-left text-sm ${
            isActivePane ? 'bg-tab-active/90 text-foreground' : 'text-muted hover:bg-raised/40'
          }`}
          type="button"
          onClick={onClick}
        >
          <PaneLeadingIcon info={info} isActivePane={isActivePane} paneIndex={paneIndex} />
          {indicator && (
            <span
              aria-label={indicator.label}
              className={indicator.className}
              title={indicator.title}
            />
          )}
          <div className="min-w-0 flex-1">
            {/* Label is the runtime summary (foregroundCommand when running, cwd basename otherwise),
                while the detail row keeps cwd context in a shortened form. Showing foregroundCommand
                again in the detail row would just duplicate the label. */}
            <div className={`truncate ${isActivePane ? 'text-foreground' : 'text-muted'}`}>
              {label}
            </div>
            {pane.cwd && (
              <div className="mt-1 truncate text-[11px] text-muted" title={pane.cwd}>
                {cwdLabel}
              </div>
            )}
          </div>
        </button>
      </div>
    </div>
  );
}

export function WorkspacesView(): React.JSX.Element {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const paneInfosByPtyId = usePaneInfoStore((state) => state.infosByPtyId);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const addWorkspaceTab = useWorkspaceStore((state) => state.addWorkspaceTab);
  const closeWorkspaceTab = useWorkspaceStore((state) => state.closeWorkspaceTab);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const renameWorkspaceTab = useWorkspaceStore((state) => state.renameWorkspaceTab);
  const selectWorkspacePane = useWorkspaceStore((state) => state.selectWorkspacePane);
  const selectWorkspaceTab = useWorkspaceStore((state) => state.selectWorkspaceTab);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab);
  const moveTabToWorkspace = useWorkspaceStore((state) => state.moveTabToWorkspace);
  const beginTabDrag = useTabDragStore((state) => state.begin);
  const endTabDrag = useTabDragStore((state) => state.end);
  const closeSettings = useUiStore((state) => state.closeSettings);

  // Holds the right-clicked tab (with its owning workspace) and the click point; null while closed.
  const [tabMenu, setTabMenu] = useState<{
    workspaceId: string;
    tabId: string;
    x: number;
    y: number;
  } | null>(null);

  // Tracks where an in-flight tab drag would land, driving the drop indicators. Hovering a tab row
  // shows an insertion line on that tab (`kind: 'tab'`) whether the drag stays in its workspace
  // (reorder) or crosses into another (positional move). Dropping onto a collapsed workspace's
  // header has no visible tab rows to anchor a line, so it highlights the whole destination
  // (`kind: 'workspace'`) and appends.
  const [dropTarget, setDropTarget] = useState<
    | { kind: 'tab'; workspaceId: string; tabId: string; edge: DropEdge }
    | { kind: 'workspace'; workspaceId: string }
    | null
  >(null);

  // Inline workspace creation state
  const [isCreating, setIsCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks whether Enter/Escape already handled the create action so onBlur skips it.
  const createHandledRef = useRef(false);

  // Workspace inline rename state (mirrors the TabBar rename pattern)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameCancelledRef = useRef(false);

  // Tab inline rename state (kept separate from workspace rename so the two editors are independent).
  // The owning workspaceId is held alongside the tabId so the rename targets the correct workspace
  // even if the active workspace changes while the editor is open.
  const [editingTab, setEditingTab] = useState<{ workspaceId: string; tabId: string } | null>(null);
  const [tabRenameDraft, setTabRenameDraft] = useState('');
  const tabRenameInputRef = useRef<HTMLInputElement | null>(null);
  const tabRenameCancelledRef = useRef(false);

  // Keep tree disclosure state local to the sidebar so it never becomes persisted workspace data.
  const [collapsedWorkspaceIds, setCollapsedWorkspaceIds] = useState<Set<string>>(() => new Set());

  const canDelete = workspaces.length > 1;

  // Drop disclosure entries for workspaces that no longer exist so stale ids cannot leak across
  // sessions or accidentally collapse a future workspace that happens to reuse the same id.
  // Adjusting state during render (rather than in an effect) is recommended for syncing derived
  // state with props/external state — see https://react.dev/learn/you-might-not-need-an-effect
  // — and avoids an extra render after every workspace list change.
  if (collapsedWorkspaceIds.size > 0) {
    const validIds = new Set(workspaces.map((workspace) => workspace.id));
    let hasStaleId = false;
    for (const id of collapsedWorkspaceIds) {
      if (!validIds.has(id)) {
        hasStaleId = true;
        break;
      }
    }
    if (hasStaleId) {
      setCollapsedWorkspaceIds((current) => new Set([...current].filter((id) => validIds.has(id))));
    }
  }

  useEffect(() => {
    if (!isCreating) return;
    createInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (!editingWorkspaceId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingWorkspaceId]);

  useEffect(() => {
    if (!editingTab) return;
    tabRenameInputRef.current?.focus();
    tabRenameInputRef.current?.select();
  }, [editingTab]);

  // --- Create handlers ---

  const startCreating = (): void => {
    setIsCreating(true);
    setCreateDraft('');
  };

  const cancelCreating = (): void => {
    createHandledRef.current = false;
    setIsCreating(false);
    setCreateDraft('');
  };

  const commitCreating = (): void => {
    const name = createDraft.trim() || 'Workspace';
    void createWorkspace(name);
    // Mark as handled before calling cancelCreating so the blur that fires on DOM removal skips it.
    createHandledRef.current = true;
    cancelCreating();
  };

  const handleCreateKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitCreating();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Mark as handled so the blur that fires on DOM removal does not also cancel.
      createHandledRef.current = true;
      cancelCreating();
    }
  };

  const handleCreateBlur = (): void => {
    if (createHandledRef.current) {
      createHandledRef.current = false;
      return;
    }
    // Blur without Enter/Escape: cancel (don't create unexpectedly on accidental focus loss).
    cancelCreating();
  };

  // --- Rename handlers ---

  const startRenaming = (workspaceId: string, name: string): void => {
    setEditingWorkspaceId(workspaceId);
    setRenameDraft(name);
  };

  const cancelRenaming = (): void => {
    renameCancelledRef.current = false;
    setEditingWorkspaceId(null);
    setRenameDraft('');
  };

  const commitRenaming = (): void => {
    if (editingWorkspaceId && !renameCancelledRef.current) {
      renameWorkspace(editingWorkspaceId, renameDraft);
    }
    cancelRenaming();
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRenaming();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Set before cancelRenaming so the blur fired on DOM removal sees it.
      renameCancelledRef.current = true;
      cancelRenaming();
    }
  };

  // --- Tab rename handlers ---

  const startRenamingTab = (workspaceId: string, tabId: string, name: string): void => {
    setEditingTab({ workspaceId, tabId });
    setTabRenameDraft(name);
  };

  const cancelRenamingTab = (): void => {
    tabRenameCancelledRef.current = false;
    setEditingTab(null);
    setTabRenameDraft('');
  };

  const commitRenamingTab = (): void => {
    if (editingTab && !tabRenameCancelledRef.current) {
      renameWorkspaceTab(editingTab.workspaceId, editingTab.tabId, tabRenameDraft);
    }
    cancelRenamingTab();
  };

  const handleTabRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitRenamingTab();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Set before cancelRenamingTab so the blur fired on DOM removal sees it.
      tabRenameCancelledRef.current = true;
      cancelRenamingTab();
    }
  };

  // --- Delete handler ---

  const handleDeleteWorkspace = (workspaceId: string, workspaceName: string): void => {
    if (!canDelete) return;
    if (!window.confirm(`Delete workspace "${workspaceName}"? This cannot be undone.`)) return;
    // Collapsed-state cleanup happens via the `workspaces`-sync effect above; no manual prune here.
    void deleteWorkspace(workspaceId);
  };

  const handleCreateWorkspaceTab = (workspaceId: string): void => {
    addWorkspaceTab(workspaceId);
    setCollapsedWorkspaceIds((current) => {
      const next = new Set(current);
      next.delete(workspaceId);
      return next;
    });
  };

  const toggleWorkspaceCollapsed = (workspaceId: string): void => {
    setCollapsedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  };

  // --- Tab context-menu handlers ---

  // Built lazily on open from current store state so reorder/move stay in sync if tabs change while
  // the menu is open. The sidebar tree is vertical, so reordering reads as "up" / "down".
  const buildTabMenuItems = (workspaceId: string, tabId: string): ContextMenuItem[] => {
    const workspace = workspaces.find((currentWorkspace) => currentWorkspace.id === workspaceId);
    if (!workspace) {
      return [];
    }

    const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) {
      return [];
    }

    const items: ContextMenuItem[] = [
      {
        type: 'action',
        id: 'move-up',
        label: 'Move up',
        disabled: index === 0,
        onSelect: () => {
          reorderWorkspaceTab(workspaceId, tabId, index - 1);
        },
      },
      {
        type: 'action',
        id: 'move-down',
        label: 'Move down',
        disabled: index === workspace.tabs.length - 1,
        onSelect: () => {
          reorderWorkspaceTab(workspaceId, tabId, index + 1);
        },
      },
    ];

    const otherWorkspaces = workspaces.filter(
      (currentWorkspace) => currentWorkspace.id !== workspaceId,
    );
    // Moving out the last tab would leave the workspace empty, so the destinations are only offered
    // when another tab remains behind.
    if (otherWorkspaces.length > 0 && workspace.tabs.length > 1) {
      items.push({ type: 'separator' }, { type: 'label', label: 'Move to workspace' });
      for (const target of otherWorkspaces) {
        items.push({
          type: 'action',
          id: `move-to-${target.id}`,
          label: target.name,
          onSelect: () => {
            moveTabToWorkspace(workspaceId, tabId, target.id);
          },
        });
      }
    }

    return items;
  };

  const openTabMenu = (event: MouseEvent, workspaceId: string, tabId: string): void => {
    event.preventDefault();
    // Suppress the menu when nothing is actionable (e.g. a lone tab whose move commands are all
    // disabled) so the user never sees a dead, all-disabled menu.
    if (!hasActionableItem(buildTabMenuItems(workspaceId, tabId))) {
      return;
    }
    setTabMenu({ workspaceId, tabId, x: event.clientX, y: event.clientY });
  };

  // --- Tab drag-and-drop handlers ---
  // The vertical sidebar tree supports both reordering a tab within its workspace and moving it to a
  // different workspace. A drop onto a tab row reuses the hovered tab's index for both: same
  // workspace via `reorderWorkspaceTab`, cross workspace via `moveTabToWorkspace` with the resolved
  // insertion index. A drop onto a (collapsed) workspace header still appends.
  // TODO: Split sidebar tab DnD hit zones into the tab row, an explicit "after this tab" zone, and
  // the pane area. The current tab group handler includes pane rows in its bounding rect, so the
  // midpoint and insertion indicator can feel ambiguous around the tab/pane boundary.

  const expandWorkspace = (workspaceId: string): void => {
    setCollapsedWorkspaceIds((current) => {
      if (!current.has(workspaceId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(workspaceId);
      return next;
    });
  };

  const isTabDrag = (event: DragEvent): boolean =>
    useTabDragStore.getState().dragging !== null && event.dataTransfer.types.includes(TAB_DND_MIME);

  const canMoveDraggedTabOut = (sourceWorkspaceId: string): boolean => {
    const sourceWorkspace = workspaces.find((workspace) => workspace.id === sourceWorkspaceId);
    return (sourceWorkspace?.tabs.length ?? 0) > 1;
  };

  const clearDropTarget = (): void => {
    setDropTarget(null);
  };

  const finishTabDrag = (): void => {
    // Cross-workspace drops move the source tab out from under the dragged button; clear here so
    // the transient drag source never depends on React observing a later dragend from that node.
    endTabDrag();
    clearDropTarget();
  };

  const clearDropTargetWhenLeaving = (event: DragEvent<HTMLElement>): void => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    clearDropTarget();
  };

  const handleSidebarDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!isTabDrag(event) || dropTarget === null) {
      return;
    }
    clearDropTarget();
  };

  const handleTabDragStart = (
    event: DragEvent<HTMLButtonElement>,
    workspaceId: string,
    tabId: string,
  ): void => {
    // The marker MIME identifies our tab drag during dragover (when payloads are unreadable); the
    // real source ids are held in the drag store.
    event.dataTransfer.setData(TAB_DND_MIME, tabId);
    event.dataTransfer.effectAllowed = 'move';
    beginTabDrag({ sourceWorkspaceId: workspaceId, tabId });
  };

  const handleTabDragEnd = (): void => {
    finishTabDrag();
  };

  const handleTabDragOver = (
    event: DragEvent<HTMLDivElement>,
    workspaceId: string,
    tabId: string,
  ): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event)) {
      return;
    }
    if (
      dragging.sourceWorkspaceId !== workspaceId &&
      !canMoveDraggedTabOut(dragging.sourceWorkspaceId)
    ) {
      clearDropTarget();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    // Both reorder and cross-workspace move land relative to the hovered tab, so the insertion line
    // is the right affordance for either case.
    const edge = resolveDropEdge(
      'vertical',
      { x: event.clientX, y: event.clientY },
      event.currentTarget.getBoundingClientRect(),
    );
    setDropTarget({ kind: 'tab', workspaceId, tabId, edge });
  };

  const handleTabDrop = (
    event: DragEvent<HTMLDivElement>,
    workspaceId: string,
    tabId: string,
  ): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event)) {
      return;
    }
    if (
      dragging.sourceWorkspaceId !== workspaceId &&
      !canMoveDraggedTabOut(dragging.sourceWorkspaceId)
    ) {
      finishTabDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const workspace = workspaces.find((current) => current.id === workspaceId);
    const displayIndex = workspace?.tabs.findIndex((tab) => tab.id === tabId) ?? -1;
    if (displayIndex !== -1) {
      const edge = resolveDropEdge(
        'vertical',
        { x: event.clientX, y: event.clientY },
        event.currentTarget.getBoundingClientRect(),
      );
      if (dragging.sourceWorkspaceId === workspaceId) {
        const fromIndex = workspace?.tabs.findIndex((tab) => tab.id === dragging.tabId) ?? -1;
        if (fromIndex !== -1) {
          reorderWorkspaceTab(
            workspaceId,
            dragging.tabId,
            toReorderIndex(fromIndex, displayIndex, edge),
          );
        }
      } else {
        moveTabToWorkspace(
          dragging.sourceWorkspaceId,
          dragging.tabId,
          workspaceId,
          toInsertIndex(displayIndex, edge),
        );
        expandWorkspace(workspaceId);
      }
    }
    finishTabDrag();
  };

  const handleWorkspaceBottomDragOver = (
    event: DragEvent<HTMLDivElement>,
    workspaceId: string,
  ): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event)) {
      return;
    }

    const workspace = workspaces.find((current) => current.id === workspaceId);
    if (!workspace) {
      return;
    }

    if (
      dragging.sourceWorkspaceId !== workspaceId &&
      !canMoveDraggedTabOut(dragging.sourceWorkspaceId)
    ) {
      clearDropTarget();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    // Dropping below the last tab lands at the end of the list for both reorder and cross-workspace
    // move, so anchor the insertion line after the last tab in either case.
    const lastTab = workspace.tabs.at(-1);
    if (lastTab) {
      setDropTarget({ kind: 'tab', workspaceId, tabId: lastTab.id, edge: 'after' });
    }
  };

  const handleWorkspaceBottomDrop = (
    event: DragEvent<HTMLDivElement>,
    workspaceId: string,
  ): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event)) {
      return;
    }

    const workspace = workspaces.find((current) => current.id === workspaceId);
    if (!workspace) {
      return;
    }

    if (
      dragging.sourceWorkspaceId !== workspaceId &&
      !canMoveDraggedTabOut(dragging.sourceWorkspaceId)
    ) {
      finishTabDrag();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (dragging.sourceWorkspaceId === workspaceId) {
      reorderWorkspaceTab(workspaceId, dragging.tabId, workspace.tabs.length - 1);
    } else {
      // Append: the target list does not contain the dragged tab, so its length is the tail index.
      moveTabToWorkspace(
        dragging.sourceWorkspaceId,
        dragging.tabId,
        workspaceId,
        workspace.tabs.length,
      );
      expandWorkspace(workspaceId);
    }
    finishTabDrag();
  };

  // Dropping onto a workspace header (its name row) moves a tab in from another workspace. Same as
  // dropping on one of that workspace's tabs, but reachable even when the workspace is collapsed.
  const handleWorkspaceDragOver = (event: DragEvent<HTMLDivElement>, workspaceId: string): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event) || dragging.sourceWorkspaceId === workspaceId) {
      return;
    }
    if (!canMoveDraggedTabOut(dragging.sourceWorkspaceId)) {
      clearDropTarget();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ kind: 'workspace', workspaceId });
  };

  const handleWorkspaceDrop = (event: DragEvent<HTMLDivElement>, workspaceId: string): void => {
    const dragging = useTabDragStore.getState().dragging;
    if (!dragging || !isTabDrag(event) || dragging.sourceWorkspaceId === workspaceId) {
      return;
    }
    if (!canMoveDraggedTabOut(dragging.sourceWorkspaceId)) {
      finishTabDrag();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveTabToWorkspace(dragging.sourceWorkspaceId, dragging.tabId, workspaceId);
    expandWorkspace(workspaceId);
    finishTabDrag();
  };

  return (
    <div className="mb-4" onDragOver={handleSidebarDragOver}>
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
        <span>Workspaces</span>
        <button
          className="flex size-4 items-center justify-center rounded hover:bg-raised hover:text-foreground"
          title="New workspace"
          type="button"
          onClick={startCreating}
        >
          <Plus size={12} />
        </button>
      </div>
      <div className="space-y-0.5">
        {workspaces.map((workspace) => {
          const isActive = workspace.id === activeWorkspaceId;
          const isEditing = workspace.id === editingWorkspaceId;
          const isExpanded = !collapsedWorkspaceIds.has(workspace.id);

          return (
            <div key={workspace.id} className="space-y-0.5">
              <div
                className={`group flex w-full items-center gap-1 rounded-md ${
                  dropTarget?.kind === 'workspace' && dropTarget.workspaceId === workspace.id
                    ? 'ring-1 ring-brand'
                    : ''
                }`}
                onDragOver={(event) => {
                  handleWorkspaceDragOver(event, workspace.id);
                }}
                onDragLeave={clearDropTargetWhenLeaving}
                onDrop={(event) => {
                  handleWorkspaceDrop(event, workspace.id);
                }}
              >
                {isEditing ? (
                  <input
                    ref={renameInputRef}
                    aria-label={`Rename ${workspace.name}`}
                    className="mx-2 min-w-0 flex-1 rounded border border-brand/60 bg-panel px-1.5 py-0.5 text-xs text-foreground outline-none"
                    value={renameDraft}
                    onBlur={commitRenaming}
                    onChange={(event) => {
                      setRenameDraft(event.target.value);
                    }}
                    onKeyDown={handleRenameKeyDown}
                  />
                ) : (
                  <>
                    <button
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${workspace.name}`}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground"
                      type="button"
                      onClick={() => {
                        toggleWorkspaceCollapsed(workspace.id);
                      }}
                    >
                      <ChevronRight
                        size={14}
                        className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                    <button
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-1 pr-2 text-left text-sm ${
                        isActive ? 'bg-raised text-foreground' : 'text-muted hover:bg-raised/50'
                      }`}
                      type="button"
                      onClick={() => {
                        setActiveWorkspace(workspace.id);
                        closeSettings();
                      }}
                      onDoubleClick={() => {
                        startRenaming(workspace.id, workspace.name);
                      }}
                    >
                      <Folder size={14} className={isActive ? 'text-brand' : 'text-subtle'} />
                      <span className="truncate">{workspace.name}</span>
                    </button>
                  </>
                )}
                <button
                  aria-label={`New tab in ${workspace.name}`}
                  className="invisible flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 group-hover:visible"
                  disabled={isEditing}
                  title="New tab"
                  type="button"
                  onClick={() => {
                    handleCreateWorkspaceTab(workspace.id);
                  }}
                >
                  <Plus size={12} />
                </button>
                <button
                  aria-label={`Delete ${workspace.name}`}
                  className="invisible flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-danger disabled:cursor-default disabled:opacity-40 group-hover:visible"
                  disabled={!canDelete || isEditing}
                  title={
                    canDelete ? `Delete ${workspace.name}` : 'At least one workspace is required'
                  }
                  type="button"
                  onClick={() => {
                    handleDeleteWorkspace(workspace.id, workspace.name);
                  }}
                >
                  <X size={12} />
                </button>
              </div>
              {isExpanded && (
                <div className="space-y-0.5">
                  {workspace.tabs.map((tab) => {
                    const paneCount = countPaneLeaves(tab.layout);
                    const isActiveTab = isActive && tab.id === workspace.activeTabId;
                    const isEditingTab =
                      editingTab?.workspaceId === workspace.id && editingTab.tabId === tab.id;
                    const label = `${tab.name} (${formatPaneCount(paneCount)})`;
                    const paneOrder = flattenLayout(tab.layout).panes;

                    return (
                      <div
                        key={tab.id}
                        className="relative space-y-0.5"
                        onDragOver={(event) => {
                          handleTabDragOver(event, workspace.id, tab.id);
                        }}
                        onDragLeave={clearDropTargetWhenLeaving}
                        onDrop={(event) => {
                          handleTabDrop(event, workspace.id, tab.id);
                        }}
                      >
                        {dropTarget?.kind === 'tab' &&
                          dropTarget.workspaceId === workspace.id &&
                          dropTarget.tabId === tab.id && (
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none absolute inset-x-6 z-10 h-0.5 bg-brand ${
                                dropTarget.edge === 'before' ? 'top-0' : 'bottom-0'
                              }`}
                            />
                          )}
                        <div className="pl-6">
                          <div className="group flex w-full items-center gap-1">
                            {isEditingTab ? (
                              <input
                                ref={tabRenameInputRef}
                                aria-label={`Rename ${tab.name}`}
                                className="mx-2 min-w-0 flex-1 rounded border border-brand/60 bg-panel px-1.5 py-0.5 text-xs text-foreground outline-none"
                                value={tabRenameDraft}
                                onBlur={commitRenamingTab}
                                onChange={(event) => {
                                  setTabRenameDraft(event.target.value);
                                }}
                                onKeyDown={handleTabRenameKeyDown}
                              />
                            ) : (
                              <button
                                aria-current={isActiveTab ? 'page' : undefined}
                                className={`flex min-w-0 flex-1 items-center gap-1 rounded-md py-1 pl-3 pr-2 text-left text-sm ${
                                  isActiveTab
                                    ? 'bg-tab-active text-foreground'
                                    : 'text-muted hover:bg-raised/50'
                                }`}
                                type="button"
                                draggable
                                onClick={() => {
                                  selectWorkspaceTab(workspace.id, tab.id);
                                  closeSettings();
                                }}
                                onContextMenu={(event) => {
                                  openTabMenu(event, workspace.id, tab.id);
                                }}
                                onDoubleClick={() => {
                                  startRenamingTab(workspace.id, tab.id, tab.name);
                                }}
                                onDragStart={(event) => {
                                  handleTabDragStart(event, workspace.id, tab.id);
                                }}
                                onDragEnd={handleTabDragEnd}
                              >
                                <Hash
                                  size={14}
                                  className={isActiveTab ? 'text-brand' : 'text-subtle'}
                                />
                                <span className="truncate">{label}</span>
                              </button>
                            )}
                            <button
                              aria-label={`Close ${tab.name}`}
                              className="invisible flex size-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-danger disabled:cursor-default disabled:opacity-40 group-hover:visible"
                              // `closeWorkspaceTab` is the single source of truth for the
                              // "at least one tab" invariant; this disabled guard is a UI hint to
                              // avoid showing a clickable button that would silently no-op.
                              disabled={workspace.tabs.length <= 1 || isEditingTab}
                              title={
                                workspace.tabs.length > 1
                                  ? `Close ${tab.name}`
                                  : 'At least one tab is required'
                              }
                              type="button"
                              onClick={() => {
                                closeWorkspaceTab(workspace.id, tab.id);
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-0.5">
                          {paneOrder.map(({ paneId }, paneIndex) => {
                            const pane = workspace.panes.find(
                              (currentPane) => currentPane.id === paneId,
                            );
                            if (!pane) {
                              return null;
                            }

                            const info = pane.ptyId ? paneInfosByPtyId[pane.ptyId] : undefined;
                            const isActivePane = isActiveTab && pane.id === tab.activePaneId;
                            return (
                              <PaneSummary
                                key={pane.id}
                                info={info}
                                isActivePane={isActivePane}
                                isActiveTab={isActiveTab}
                                pane={pane}
                                paneIndex={paneIndex}
                                onClick={() => {
                                  selectWorkspacePane(workspace.id, tab.id, pane.id);
                                  closeSettings();
                                }}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <div
                    aria-hidden="true"
                    className="h-2"
                    data-workspace-bottom-drop-zone={workspace.id}
                    onDragOver={(event) => {
                      handleWorkspaceBottomDragOver(event, workspace.id);
                    }}
                    onDragLeave={clearDropTargetWhenLeaving}
                    onDrop={(event) => {
                      handleWorkspaceBottomDrop(event, workspace.id);
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {isCreating && (
          <div className="flex items-center gap-2 rounded-md px-2 py-1">
            <Plus size={14} className="shrink-0 text-subtle" />
            <input
              ref={createInputRef}
              className="min-w-0 flex-1 rounded border border-brand/60 bg-panel px-1.5 py-0.5 text-sm text-foreground outline-none"
              placeholder="Workspace name"
              value={createDraft}
              onBlur={handleCreateBlur}
              onChange={(event) => {
                setCreateDraft(event.target.value);
              }}
              onKeyDown={handleCreateKeyDown}
            />
          </div>
        )}
      </div>
      {tabMenu && (
        <ContextMenu
          position={{ x: tabMenu.x, y: tabMenu.y }}
          items={buildTabMenuItems(tabMenu.workspaceId, tabMenu.tabId)}
          onClose={() => {
            setTabMenu(null);
          }}
        />
      )}
    </div>
  );
}
