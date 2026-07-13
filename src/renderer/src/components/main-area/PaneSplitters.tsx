import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import type { SplitRect } from '../../../../shared/pane-layout';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function splitKeyFor(path: number[]): string {
  // Encode the empty (root) path as `root` so it is visibly distinct from the `0`/`1` leaf keys
  // that nested splits emit.
  return path.length === 0 ? 'root' : path.join('.');
}

interface PaneSplittersProps {
  splits: SplitRect[];
}

/**
 * Renders the resize handles for the active tab in a coordinate layer shared with every pane.
 */
export function PaneSplitters({ splits }: PaneSplittersProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20">
      {splits.map((split) => (
        <SplitterHandle key={splitKeyFor(split.path)} containerRef={containerRef} split={split} />
      ))}
    </div>
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
      className={`pointer-events-auto z-10 bg-border-subtle hover:bg-border-pane-active ${
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
