import { Columns2, Rows2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Pane, PaneLayout as PaneLayoutModel, Tab } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TerminalView } from '../terminal/TerminalView';

interface PaneLayoutProps {
  layout: PaneLayoutModel;
  panes: Pane[];
  path?: number[];
  tab: Tab;
}

function countLeaves(layout: PaneLayoutModel): number {
  if (layout.type === 'leaf') {
    return 1;
  }

  return countLeaves(layout.children[0]) + countLeaves(layout.children[1]);
}

function findPane(panes: Pane[], paneId: string): Pane | null {
  return panes.find((pane) => pane.id === paneId) ?? null;
}

/**
 * Recursively renders a terminal pane layout tree with split, close, focus, and resize controls.
 */
export function PaneLayout({
  layout,
  panes,
  path = [],
  tab,
}: PaneLayoutProps): React.JSX.Element | null {
  const closePane = useWorkspaceStore((state) => state.closePane);
  const resizeSplit = useWorkspaceStore((state) => state.resizeSplit);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const updatePaneCwd = useWorkspaceStore((state) => state.updatePaneCwd);
  const dragControllerRef = useRef<AbortController | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      dragControllerRef.current?.abort();
    };
  }, []);

  if (layout.type === 'leaf') {
    const pane = findPane(panes, layout.paneId);
    if (!pane) {
      return null;
    }

    const isActive = tab.activePaneId === pane.id;
    const canClosePane = countLeaves(tab.layout) > 1;

    return (
      <section
        className={`group relative h-full min-h-0 w-full overflow-hidden border ${
          isActive ? 'border-brand/70' : 'border-border-subtle'
        }`}
        onMouseDown={() => {
          // This fires only for the active tab because inactive tab containers use
          // `pointer-events-none`. The store pane actions operate on `selectActiveTab()` for the
          // same reason, so the rendered tab prop and active store tab are intentionally aligned.
          setActivePane(pane.id);
        }}
      >
        <TerminalView
          cwd={pane.cwd}
          onCwdChange={(cwd) => {
            updatePaneCwd(pane.id, cwd);
          }}
        />
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded bg-panel/90 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            aria-label="Split pane vertically"
            className="flex size-6 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground"
            title="Split pane vertically"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              splitPane(pane.id, 'vertical');
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <Columns2 size={13} />
          </button>
          <button
            aria-label="Split pane horizontally"
            className="flex size-6 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground"
            title="Split pane horizontally"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              splitPane(pane.id, 'horizontal');
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <Rows2 size={13} />
          </button>
          <button
            aria-label="Close pane"
            className="flex size-6 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-subtle"
            disabled={!canClosePane}
            title={canClosePane ? 'Close pane' : 'At least one pane is required'}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closePane(pane.id);
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
          >
            <X size={13} />
          </button>
        </div>
      </section>
    );
  }

  const isVertical = layout.direction === 'vertical';

  return (
    <div
      ref={splitContainerRef}
      className={`flex h-full min-h-0 w-full ${isVertical ? 'flex-row' : 'flex-col'}`}
    >
      <div
        className="min-h-0 min-w-0"
        style={
          isVertical ? { width: `${layout.ratio * 100}%` } : { height: `${layout.ratio * 100}%` }
        }
      >
        <PaneLayout layout={layout.children[0]} panes={panes} path={[...path, 0]} tab={tab} />
      </div>
      <div
        aria-label={isVertical ? 'Resize vertical split' : 'Resize horizontal split'}
        className={`shrink-0 bg-border-subtle hover:bg-brand ${
          isVertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
        }`}
        role="separator"
        onMouseDown={(event) => {
          event.preventDefault();
          const container = splitContainerRef.current;
          if (!container) {
            return;
          }

          dragControllerRef.current?.abort();
          const controller = new AbortController();
          dragControllerRef.current = controller;

          const handleMouseMove = (moveEvent: MouseEvent): void => {
            const bounds = container.getBoundingClientRect();
            const rawRatio = isVertical
              ? (moveEvent.clientX - bounds.left) / bounds.width
              : (moveEvent.clientY - bounds.top) / bounds.height;
            resizeSplit(path, rawRatio);
          };
          const handleMouseUp = (): void => {
            controller.abort();
            if (dragControllerRef.current === controller) {
              dragControllerRef.current = null;
            }
          };

          const { signal } = controller;
          window.addEventListener('mousemove', handleMouseMove, { signal });
          window.addEventListener('mouseup', handleMouseUp, { signal });
        }}
      />
      <div
        className="min-h-0 min-w-0"
        style={
          isVertical
            ? { width: `${(1 - layout.ratio) * 100}%` }
            : { height: `${(1 - layout.ratio) * 100}%` }
        }
      >
        <PaneLayout layout={layout.children[1]} panes={panes} path={[...path, 1]} tab={tab} />
      </div>
    </div>
  );
}
