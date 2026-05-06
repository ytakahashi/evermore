import type { PaneLayout } from './types';

/**
 * Counts terminal pane leaves in a persisted pane layout tree.
 */
export function countPaneLeaves(layout: PaneLayout): number {
  if (layout.type === 'leaf') {
    return 1;
  }

  return countPaneLeaves(layout.children[0]) + countPaneLeaves(layout.children[1]);
}

/**
 * Absolute placement (in container percentage units) of a single terminal pane leaf.
 */
export interface PaneRect {
  paneId: string;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

/**
 * Absolute placement (in container percentage units) of a split node, plus the path the renderer
 * must pass back to `resizeSplit` when its handle is dragged.
 */
export interface SplitRect {
  path: number[];
  direction: 'horizontal' | 'vertical';
  ratio: number;
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

export interface FlattenedLayout {
  panes: PaneRect[];
  splits: SplitRect[];
}

/**
 * Walks a pane layout tree and returns each leaf and split as an absolute rect in container
 * percentage units. The renderer can then place every leaf as a sibling under one container,
 * which keeps `<TerminalView>` identity stable across splits and closes (they no longer change
 * tree depth, so React does not unmount/remount the xterm + PTY pair).
 *
 * Percentages are used (not px) so the browser handles container resizes natively without a
 * ResizeObserver re-flattening every leaf.
 *
 * `path` is `[]` at the root, with `0` / `1` pushed for each `children[0]` / `children[1]` step,
 * matching the encoding `resizeSplit(path, ratio)` expects in the workspace store.
 */
export function flattenLayout(layout: PaneLayout): FlattenedLayout {
  const panes: PaneRect[] = [];
  const splits: SplitRect[] = [];
  walkLayout(layout, [], 0, 0, 100, 100, panes, splits);
  return { panes, splits };
}

function walkLayout(
  layout: PaneLayout,
  path: number[],
  leftPct: number,
  topPct: number,
  widthPct: number,
  heightPct: number,
  panes: PaneRect[],
  splits: SplitRect[],
): void {
  if (layout.type === 'leaf') {
    panes.push({ paneId: layout.paneId, leftPct, topPct, widthPct, heightPct });
    return;
  }

  splits.push({
    path,
    direction: layout.direction,
    ratio: layout.ratio,
    leftPct,
    topPct,
    widthPct,
    heightPct,
  });

  if (layout.direction === 'vertical') {
    const firstWidth = widthPct * layout.ratio;
    const secondWidth = widthPct - firstWidth;
    walkLayout(
      layout.children[0],
      [...path, 0],
      leftPct,
      topPct,
      firstWidth,
      heightPct,
      panes,
      splits,
    );
    walkLayout(
      layout.children[1],
      [...path, 1],
      leftPct + firstWidth,
      topPct,
      secondWidth,
      heightPct,
      panes,
      splits,
    );
    return;
  }

  const firstHeight = heightPct * layout.ratio;
  const secondHeight = heightPct - firstHeight;
  walkLayout(
    layout.children[0],
    [...path, 0],
    leftPct,
    topPct,
    widthPct,
    firstHeight,
    panes,
    splits,
  );
  walkLayout(
    layout.children[1],
    [...path, 1],
    leftPct,
    topPct + firstHeight,
    widthPct,
    secondHeight,
    panes,
    splits,
  );
}
