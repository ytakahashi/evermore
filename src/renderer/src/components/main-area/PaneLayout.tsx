import { Columns2, Maximize, Minimize, Rows2, X } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { countPaneLeaves, type PaneRect, type SplitRect } from '../../../../shared/pane-layout';
import { DEFAULT_KEYBINDINGS } from '../../../../shared/keyboard-shortcuts';
import type { Pane, Tab } from '../../../../shared/types';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings-defaults';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { TerminalView } from '../terminal/TerminalView';
import type { PtyIdChangeReason } from '../terminal/useTerminal';

// Map Electron accelerator tokens to macOS keyboard symbols used in tooltip / aria-label hints.
// macOS-only project, so only the modifier names emitted by `keyboard-shortcuts.ts` are listed.
const ACCELERATOR_SYMBOLS: Record<string, string> = {
  Command: '⌘',
  Control: '⌃',
  Option: '⌥',
  Shift: '⇧',
  Return: '↩',
  Enter: '↩',
  Escape: 'Esc',
  Tab: '⇥',
  Backspace: '⌫',
  Delete: '⌦',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Space: '␣',
};

function formatAcceleratorSymbols(accelerator: string): string {
  if (accelerator.length === 0) {
    return '';
  }
  return accelerator
    .split('+')
    .map((part) => ACCELERATOR_SYMBOLS[part] ?? part)
    .join('');
}

function splitKeyFor(path: number[]): string {
  // Encode the empty (root) path as `root` so it is visibly distinct from the `0`/`1` leaf keys
  // that nested splits emit.
  return path.length === 0 ? 'root' : path.join('.');
}

export interface PaneCellProps {
  isActiveWorkspace: boolean;
  isFullscreen: boolean;
  isFullscreenLayout: boolean;
  isActiveTab: boolean;
  pane: Pane;
  rect: PaneRect;
  tab: Tab;
}

/**
 * One absolutely positioned terminal pane, including the hover toolbar and active-pane border.
 *
 * `MainTerminalArea` mounts every pane of every tab/workspace as a flat sibling list keyed by
 * `pane.id`, rather than nesting `PaneCell` under a per-tab container. That keeps each pane at a
 * fixed React tree position independent of which tab currently owns it, so moving a pane between
 * tabs does not unmount its `TerminalView` (and therefore its xterm/PTY). Do not reintroduce a
 * per-tab wrapper component around `PaneCell` without preserving that invariant.
 */
export function PaneCell({
  isActiveWorkspace,
  isFullscreen,
  isFullscreenLayout,
  isActiveTab,
  pane,
  rect,
  tab,
}: PaneCellProps): React.JSX.Element {
  const closePane = useWorkspaceStore((state) => state.closePane);
  const closePaneOnExit = useWorkspaceStore((state) => state.closePaneOnExit);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const setPanePtyId = useWorkspaceStore((state) => state.setPanePtyId);
  const splitPane = useWorkspaceStore((state) => state.splitPane);
  const removePaneInfo = usePaneInfoStore((state) => state.removeInfo);
  const setFullscreenPaneId = useUiStore((state) => state.setFullscreenPaneId);
  const closePaneOnExitEnabled = useSettingsStore(
    (state) =>
      state.settings?.terminal.closePaneOnExit ?? DEFAULT_APP_SETTINGS.terminal.closePaneOnExit,
  );
  const toggleFullscreenAccelerator = useSettingsStore(
    (state) =>
      state.settings?.shortcuts.keybindings['pane.toggleFullscreen'] ??
      DEFAULT_KEYBINDINGS['pane.toggleFullscreen'],
  );
  const toggleFullscreenHint = formatAcceleratorSymbols(toggleFullscreenAccelerator);
  const exitFullscreenLabel = toggleFullscreenHint
    ? `Exit fullscreen (${toggleFullscreenHint})`
    : 'Exit fullscreen';

  const isActive = isActiveTab && tab.activePaneId === pane.id;
  const canClosePane = countPaneLeaves(tab.layout) > 1;
  const isHiddenByFullscreen = isFullscreenLayout && !isFullscreen;

  return (
    <section
      aria-hidden={!isActiveTab}
      className={`group absolute overflow-hidden border ${
        isActive ? 'border-border-pane-active/70' : 'border-border-subtle'
      } ${isActiveTab ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'} ${
        isHiddenByFullscreen ? 'pointer-events-none invisible' : ''
      }`}
      style={{
        display: isActiveWorkspace ? undefined : 'none',
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
        paneId={pane.id}
        onPtyIdChange={(ptyId: string | null, reason: PtyIdChangeReason) => {
          // A null PTY id can mean either process exit or React unmount. Both retire the old
          // runtime id, but only a real exit should trigger close-pane-on-exit; unmounts also occur
          // during tab/workspace moves and should not mutate the pane tree.
          if (ptyId === null && pane.ptyId) {
            removePaneInfo(pane.ptyId);
            if (reason === 'exit' && closePaneOnExitEnabled) {
              // On PTY exit, drop the pane (and the tab if this was the only pane left). The action
              // is intentionally skipped for unmount cleanup so moving a tab between workspaces does
              // not look like the shell exited.
              closePaneOnExit(pane.id);
            }
          }
          setPanePtyId(pane.id, ptyId);
        }}
      />
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded bg-panel/90 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          aria-label={isFullscreen ? exitFullscreenLabel : 'Maximize pane'}
          className="flex size-6 items-center justify-center rounded text-subtle hover:bg-raised hover:text-foreground"
          title={isFullscreen ? exitFullscreenLabel : 'Maximize pane'}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!isFullscreen) {
              setActivePane(pane.id);
            }
            setFullscreenPaneId(isFullscreen ? null : pane.id);
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
        </button>
        {/* Fullscreen is a focus mode. Hide structural actions here so users leave fullscreen
            before changing the pane tree, which avoids confusing split/close outcomes. */}
        {!isFullscreenLayout && (
          <>
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
          </>
        )}
      </div>
    </section>
  );
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
