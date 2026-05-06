import { Columns2, Rows2, X } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import {
  countPaneLeaves,
  flattenLayout,
  type PaneRect,
  type SplitRect,
} from '../../../../shared/pane-layout';
import type { Pane, PaneLayout as PaneLayoutModel, Tab } from '../../../../shared/types';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TerminalView } from '../terminal/TerminalView';

interface PaneLayoutProps {
  isActiveTab: boolean;
  layout: PaneLayoutModel;
  panes: Pane[];
  tab: Tab;
}

/**
 * Renders a tab's pane layout as flat siblings under a single absolute container.
 *
 * The previous implementation rendered the layout tree recursively, which moved each
 * `<TerminalView>` to a different tree depth whenever the user split or closed a pane. React
 * treats moved subtrees as new identities, so the xterm + PTY pair was unmounted and recreated.
 *
 * Flattening keeps every leaf at a fixed tree depth keyed by `pane.id`, so the xterm and PTY
 * survive layout changes. Resizing still works because each leaf is positioned in container
 * percentage units, which the browser rescales natively without re-flattening.
 */
export function PaneLayout({
  isActiveTab,
  layout,
  panes,
  tab,
}: PaneLayoutProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { panes: paneRects, splits: splitRects } = flattenLayout(layout);

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full">
      {paneRects.map((rect) => {
        const pane = panes.find((currentPane) => currentPane.id === rect.paneId);
        if (!pane) {
          console.warn(`Pane with id ${rect.paneId} not found for leaf layout`);
          return null;
        }

        return (
          <PaneCell key={pane.id} isActiveTab={isActiveTab} pane={pane} rect={rect} tab={tab} />
        );
      })}
      {splitRects.map((split) => (
        <SplitterHandle key={splitKeyFor(split.path)} containerRef={containerRef} split={split} />
      ))}
    </div>
  );
}

function splitKeyFor(path: number[]): string {
  // Encode the empty (root) path as `root` so it is visibly distinct from the `0`/`1` leaf keys
  // that nested splits emit.
  return path.length === 0 ? 'root' : path.join('.');
}

interface PaneCellProps {
  isActiveTab: boolean;
  pane: Pane;
  rect: PaneRect;
  tab: Tab;
}

/**
 * One absolutely positioned terminal pane, including the hover toolbar and active-pane border.
 */
function PaneCell({ isActiveTab, pane, rect, tab }: PaneCellProps): React.JSX.Element {
  const closePane = useWorkspaceStore((state) => state.closePane);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const updatePaneCwd = useWorkspaceStore((state) => state.updatePaneCwd);

  const isActive = isActiveTab && tab.activePaneId === pane.id;
  const canClosePane = countPaneLeaves(tab.layout) > 1;

  return (
    <section
      className={`group absolute overflow-hidden border ${
        isActive ? 'border-brand/70' : 'border-border-subtle'
      }`}
      style={{
        left: `${rect.leftPct}%`,
        top: `${rect.topPct}%`,
        width: `${rect.widthPct}%`,
        height: `${rect.heightPct}%`,
      }}
      onMouseDown={() => {
        // This fires only for the active tab because inactive tab containers use
        // `pointer-events-none`. The store pane actions operate on `selectActiveTab()` for the
        // same reason, so the rendered tab prop and active store tab are intentionally aligned.
        setActivePane(pane.id);
      }}
    >
      <TerminalView
        cwd={pane.cwd}
        initialCommand={pane.initialCommand}
        isActive={isActive}
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

interface SplitterHandleProps {
  containerRef: RefObject<HTMLDivElement | null>;
  split: SplitRect;
}

const SPLITTER_THICKNESS_PX = 4;

/**
 * Drag handle for one split node. Drag-time ratio is computed from the split's own bounding box
 * (derived from the container rect plus the split's percentage offsets), so nested splits stay
 * isolated from one another even though they all live as siblings under the root container.
 */
function SplitterHandle({ containerRef, split }: SplitterHandleProps): React.JSX.Element {
  const resizeSplit = useWorkspaceStore((state) => state.resizeSplit);
  const dragControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      dragControllerRef.current?.abort();
    };
  }, []);

  const isVertical = split.direction === 'vertical';
  const halfThickness = SPLITTER_THICKNESS_PX / 2;
  const centerPct = isVertical
    ? split.leftPct + split.widthPct * split.ratio
    : split.topPct + split.heightPct * split.ratio;

  const style: CSSProperties = isVertical
    ? {
        position: 'absolute',
        top: `${split.topPct}%`,
        height: `${split.heightPct}%`,
        left: `calc(${centerPct}% - ${halfThickness}px)`,
        width: `${SPLITTER_THICKNESS_PX}px`,
      }
    : {
        position: 'absolute',
        left: `${split.leftPct}%`,
        width: `${split.widthPct}%`,
        top: `calc(${centerPct}% - ${halfThickness}px)`,
        height: `${SPLITTER_THICKNESS_PX}px`,
      };

  return (
    <div
      aria-label={isVertical ? 'Resize vertical split' : 'Resize horizontal split'}
      className={`z-10 bg-border-subtle hover:bg-brand ${
        isVertical ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
      role="separator"
      style={style}
      onMouseDown={(event) => {
        event.preventDefault();
        const container = containerRef.current;
        if (!container) {
          return;
        }

        dragControllerRef.current?.abort();
        const controller = new AbortController();
        dragControllerRef.current = controller;

        const handleMouseMove = (moveEvent: MouseEvent): void => {
          const bounds = container.getBoundingClientRect();
          const splitLeft = bounds.left + (split.leftPct / 100) * bounds.width;
          const splitTop = bounds.top + (split.topPct / 100) * bounds.height;
          const splitWidth = (split.widthPct / 100) * bounds.width;
          const splitHeight = (split.heightPct / 100) * bounds.height;
          if (splitWidth <= 0 || splitHeight <= 0) {
            return;
          }

          const rawRatio = isVertical
            ? (moveEvent.clientX - splitLeft) / splitWidth
            : (moveEvent.clientY - splitTop) / splitHeight;
          resizeSplit(split.path, rawRatio);
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
  );
}
