import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { createTabSearchEntries, filterTabSearchEntries, type TabSearchEntry } from './tabSearch';

const MAX_VISIBLE_RESULTS = 12;

/**
 * Renders a VS Code-style quick picker for jumping to any loaded tab by tab name.
 */
export function TabSearchPalette(): React.JSX.Element | null {
  const isOpen = useUiStore((state) => state.tabSearchOpen);
  const closeTabSearch = useUiStore((state) => state.closeTabSearch);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const selectWorkspaceTab = useWorkspaceStore((state) => state.selectWorkspaceTab);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(
    () => createTabSearchEntries(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );
  const filteredEntries = useMemo(
    () => filterTabSearchEntries(entries, query).slice(0, MAX_VISIBLE_RESULTS),
    [entries, query],
  );

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const clampedSelectedIndex =
    filteredEntries.length === 0 ? 0 : Math.min(selectedIndex, filteredEntries.length - 1);
  const selectedEntry = filteredEntries[clampedSelectedIndex] ?? null;

  const close = (): void => {
    setQuery('');
    setSelectedIndex(0);
    closeTabSearch();
  };

  const selectEntry = (entry: TabSearchEntry): void => {
    selectWorkspaceTab(entry.workspaceId, entry.tabId);
    setActiveView('workspace');
    close();
  };

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      close();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filteredEntries.length > 0) {
        setSelectedIndex(
          (current) => (Math.min(current, clampedSelectedIndex) + 1) % filteredEntries.length,
        );
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filteredEntries.length > 0) {
        setSelectedIndex(
          (current) =>
            (Math.min(current, clampedSelectedIndex) - 1 + filteredEntries.length) %
            filteredEntries.length,
        );
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (selectedEntry) {
        selectEntry(selectedEntry);
      }
    }
  };

  const emptyText = entries.length === 0 ? 'No tabs available' : 'No tabs match';

  return (
    <div
      aria-label="Search tabs"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-20"
      role="dialog"
      onKeyDown={handleDialogKeyDown}
      onMouseDown={handleBackdropMouseDown}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl">
        <div className="flex h-12 items-center border-b border-border px-3">
          <Search aria-hidden="true" className="mr-2 shrink-0 text-muted" size={18} />
          <input
            ref={inputRef}
            aria-activedescendant={
              selectedEntry ? `tab-search-option-${selectedEntry.tabId}` : undefined
            }
            aria-autocomplete="list"
            aria-controls="tab-search-results"
            aria-expanded="true"
            aria-label="Search tabs by tab name"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle"
            placeholder="Search tabs by name"
            role="combobox"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />
        </div>
        <div className="max-h-96 overflow-y-auto py-1" id="tab-search-results" role="listbox">
          {filteredEntries.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">{emptyText}</div>
          ) : (
            filteredEntries.map((entry, index) => {
              const isSelected = index === clampedSelectedIndex;

              return (
                <button
                  key={`${entry.workspaceId}:${entry.tabId}`}
                  aria-selected={isSelected}
                  className={`grid h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 text-left text-sm outline-none ${
                    isSelected ? 'bg-raised text-foreground' : 'text-muted hover:bg-raised/50'
                  }`}
                  id={`tab-search-option-${entry.tabId}`}
                  role="option"
                  type="button"
                  onClick={() => {
                    selectEntry(entry);
                  }}
                  onMouseEnter={() => {
                    setSelectedIndex(index);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {entry.tabName}
                    </span>
                    <span className="block truncate text-xs text-subtle">
                      {entry.workspaceName}
                    </span>
                  </span>
                  {entry.isActive && (
                    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted">
                      Active
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
