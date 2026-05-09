import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, Folder, Hash, Plus, Terminal, X } from 'lucide-react';
import { countPaneLeaves, flattenLayout } from '../../../../shared/pane-layout';
import { getPathBasename } from '../../../../shared/path-label';
import type { Pane } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function formatPaneCount(count: number): string {
  return `${count} ${count === 1 ? 'pane' : 'panes'}`;
}

function PaneSummary({ pane }: { pane: Pane }): React.JSX.Element {
  const label = getPathBasename(pane.cwd, { emptyFallback: '(loading)' });

  return (
    <div className="pl-6">
      <div className="border-l border-border-subtle pl-2">
        <div className="flex min-w-0 items-start gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-raised/40">
          <Terminal size={13} className="mt-0.5 shrink-0 text-subtle/70" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-foreground">{label}</div>
            {pane.cwd && <div className="mt-1 truncate text-[11px] text-muted">{pane.cwd}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WorkspacesView(): React.JSX.Element {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const createWorkspace = useWorkspaceStore((state) => state.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((state) => state.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((state) => state.renameWorkspace);
  const selectWorkspaceTab = useWorkspaceStore((state) => state.selectWorkspaceTab);
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace);

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

  const canDelete = workspaces.length > 1;

  useEffect(() => {
    if (!isCreating) return;
    createInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (!editingWorkspaceId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingWorkspaceId]);

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

  // --- Delete handler ---

  const handleDeleteWorkspace = (workspaceId: string, workspaceName: string): void => {
    if (!canDelete) return;
    if (!window.confirm(`Delete workspace "${workspaceName}"? This cannot be undone.`)) return;
    void deleteWorkspace(workspaceId);
  };

  return (
    <div className="mb-4">
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

          return (
            <div key={workspace.id} className="space-y-0.5">
              <div className="group flex w-full items-center gap-1 pr-1">
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
                  <button
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${
                      isActive ? 'bg-raised text-foreground' : 'text-muted hover:bg-raised/50'
                    }`}
                    type="button"
                    onClick={() => {
                      setActiveWorkspace(workspace.id);
                    }}
                    onDoubleClick={() => {
                      startRenaming(workspace.id, workspace.name);
                    }}
                  >
                    <ChevronRight size={14} className="rotate-90 text-subtle" />
                    <Folder size={14} className={isActive ? 'text-brand' : 'text-subtle'} />
                    <span className="truncate">{workspace.name}</span>
                  </button>
                )}
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
              <div className="space-y-0.5">
                {workspace.tabs.map((tab) => {
                  const paneCount = countPaneLeaves(tab.layout);
                  const isActiveTab = isActive && tab.id === workspace.activeTabId;
                  const label = `${tab.name} (${formatPaneCount(paneCount)})`;
                  const paneOrder = flattenLayout(tab.layout).panes;

                  return (
                    <div key={tab.id} className="space-y-0.5">
                      <button
                        aria-current={isActiveTab ? 'page' : undefined}
                        className={`flex w-full items-center gap-2 rounded-md py-1 pl-8 pr-2 text-left text-sm ${
                          isActiveTab
                            ? 'bg-tab-active text-foreground'
                            : 'text-muted hover:bg-raised/50'
                        }`}
                        type="button"
                        onClick={() => {
                          selectWorkspaceTab(workspace.id, tab.id);
                        }}
                      >
                        <Hash size={14} className={isActiveTab ? 'text-brand' : 'text-subtle'} />
                        <span className="truncate">{label}</span>
                      </button>
                      <div className="space-y-0.5">
                        {paneOrder.map(({ paneId }) => {
                          const pane = workspace.panes.find(
                            (currentPane) => currentPane.id === paneId,
                          );
                          if (!pane) {
                            return null;
                          }

                          return <PaneSummary key={pane.id} pane={pane} />;
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
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
    </div>
  );
}
