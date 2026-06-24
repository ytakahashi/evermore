import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { selectActiveWorkspace, useWorkspaceStore } from '../../stores/workspaceStore';
import { ContextMenu } from '../common/ContextMenu';
import { hasActionableItem, type ContextMenuItem } from '../common/contextMenuItems';

export function TabBar(): React.JSX.Element {
  const activeWorkspace = useWorkspaceStore(selectActiveWorkspace);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const renameTab = useWorkspaceStore((state) => state.renameTab);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const reorderWorkspaceTab = useWorkspaceStore((state) => state.reorderWorkspaceTab);
  const moveTabToWorkspace = useWorkspaceStore((state) => state.moveTabToWorkspace);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  // Holds the right-clicked tab id and the click point; null while the menu is closed.
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);
  const tabs = activeWorkspace?.tabs ?? [];
  const activeTabId = activeWorkspace?.activeTabId ?? null;
  const canCloseTabs = tabs.length > 1;

  // Built lazily on open from current store state so reorder/move stay in sync if tabs change while
  // the menu is open. The tab bar is horizontal, so reordering reads as "left" / "right".
  const buildMenuItems = (tabId: string): ContextMenuItem[] => {
    if (!activeWorkspace) {
      return [];
    }

    const index = activeWorkspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) {
      return [];
    }

    const items: ContextMenuItem[] = [
      {
        type: 'action',
        id: 'move-left',
        label: 'Move left',
        disabled: index === 0,
        onSelect: () => {
          reorderWorkspaceTab(activeWorkspace.id, tabId, index - 1);
        },
      },
      {
        type: 'action',
        id: 'move-right',
        label: 'Move right',
        disabled: index === activeWorkspace.tabs.length - 1,
        onSelect: () => {
          reorderWorkspaceTab(activeWorkspace.id, tabId, index + 1);
        },
      },
    ];

    const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== activeWorkspace.id);
    // Moving out the last tab would leave the workspace empty, so the destinations are only offered
    // when another tab remains behind.
    if (otherWorkspaces.length > 0 && activeWorkspace.tabs.length > 1) {
      items.push({ type: 'separator' }, { type: 'label', label: 'Move to workspace' });
      for (const workspace of otherWorkspaces) {
        items.push({
          type: 'action',
          id: `move-to-${workspace.id}`,
          label: workspace.name,
          onSelect: () => {
            moveTabToWorkspace(activeWorkspace.id, tabId, workspace.id);
          },
        });
      }
    }

    return items;
  };

  const openTabMenu = (event: MouseEvent, tabId: string): void => {
    event.preventDefault();
    // Suppress the menu when nothing is actionable (e.g. a lone tab whose move commands are all
    // disabled) so the user never sees a dead, all-disabled menu.
    if (!hasActionableItem(buildMenuItems(tabId))) {
      return;
    }
    setMenu({ tabId, x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    if (!editingTabId) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingTabId]);

  const startEditing = (tabId: string, name: string): void => {
    setEditingTabId(tabId);
    setDraftTitle(name);
  };

  const cancelEditing = (): void => {
    cancelledRef.current = false;
    setEditingTabId(null);
    setDraftTitle('');
  };

  const commitEditing = (): void => {
    if (editingTabId && !cancelledRef.current) {
      renameTab(editingTabId, draftTitle);
    }

    cancelEditing();
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEditing();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      // Set the flag before cancelEditing so that the blur fired by DOM removal sees it.
      cancelledRef.current = true;
      cancelEditing();
    }
  };

  return (
    <div className="flex h-9 items-center overflow-hidden border-b border-border bg-panel px-2">
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = tab.id === editingTabId;

          return (
            <div
              key={tab.id}
              className={`flex h-full min-w-36 max-w-52 items-center border-r border-border text-xs ${
                isActive
                  ? 'bg-tab-active text-foreground'
                  : 'bg-panel text-muted hover:bg-raised/50'
              }`}
              onContextMenu={(event) => {
                openTabMenu(event, tab.id);
              }}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  aria-label={`Rename ${tab.name}`}
                  className="mx-2 min-w-0 flex-1 rounded border border-brand/60 bg-panel px-1.5 py-0.5 text-xs text-foreground outline-none"
                  value={draftTitle}
                  onBlur={commitEditing}
                  onChange={(event) => {
                    setDraftTitle(event.target.value);
                  }}
                  onKeyDown={handleEditorKeyDown}
                />
              ) : (
                <button
                  aria-current={isActive ? 'page' : undefined}
                  className="h-full min-w-0 flex-1 px-3 text-left"
                  type="button"
                  onClick={() => {
                    selectTab(tab.id);
                  }}
                  onDoubleClick={() => {
                    startEditing(tab.id, tab.name);
                  }}
                >
                  <span className="block truncate">{tab.name}</span>
                </button>
              )}
              <button
                aria-label={`Close ${tab.name}`}
                className="mr-1 flex size-6 shrink-0 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-subtle"
                disabled={!canCloseTabs || isEditing}
                title={canCloseTabs ? `Close ${tab.name}` : 'At least one tab is required'}
                type="button"
                onClick={() => {
                  closeTab(tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        aria-label="New tab"
        className="ml-2 flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
        disabled={!activeWorkspace}
        title="New tab"
        type="button"
        onClick={addTab}
      >
        <Plus size={14} />
      </button>
      {menu && (
        <ContextMenu
          position={{ x: menu.x, y: menu.y }}
          items={buildMenuItems(menu.tabId)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
