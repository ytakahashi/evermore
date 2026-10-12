import type { PaneLayout } from './types';
import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from './pane-layout-constants';

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
 * Returns pane ids in depth-first layout order.
 */
export function collectPaneIds(layout: PaneLayout): string[] {
  if (layout.type === 'leaf') {
    return [layout.paneId];
  }

  return [...collectPaneIds(layout.children[0]), ...collectPaneIds(layout.children[1])];
}

/**
 * Returns the first leaf pane id in a layout tree.
 */
export function findFirstPaneId(layout: PaneLayout): string | null {
  if (layout.type === 'leaf') {
    return layout.paneId;
  }

  return findFirstPaneId(layout.children[0]) ?? findFirstPaneId(layout.children[1]);
}

function clampSplitRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

/**
 * Replaces every matching pane leaf without mutating the input layout.
 */
export function replacePaneLayout(
  layout: PaneLayout,
  paneId: string,
  replacement: PaneLayout,
): PaneLayout {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? replacement : layout;
  }

  return {
    ...layout,
    children: [
      replacePaneLayout(layout.children[0], paneId, replacement),
      replacePaneLayout(layout.children[1], paneId, replacement),
    ],
  };
}

/**
 * Remaps leaf ids using the supplied mapping, preserving ids absent from the mapping.
 */
export function remapPaneLayoutIds(
  layout: PaneLayout,
  paneIdByOldId: ReadonlyMap<string, string>,
): PaneLayout {
  if (layout.type === 'leaf') {
    return {
      ...layout,
      paneId: paneIdByOldId.get(layout.paneId) ?? layout.paneId,
    };
  }

  return {
    ...layout,
    children: [
      remapPaneLayoutIds(layout.children[0], paneIdByOldId),
      remapPaneLayoutIds(layout.children[1], paneIdByOldId),
    ],
  };
}

/**
 * Removes the first matching leaf in depth-first order and collapses its vacated split.
 * Returns a null layout when the root leaf is removed; an absent pane leaves the tree unchanged.
 */
export function removePaneLayout(
  layout: PaneLayout,
  paneId: string,
): { layout: PaneLayout | null; removed: boolean } {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? { layout: null, removed: true } : { layout, removed: false };
  }

  const firstChild = removePaneLayout(layout.children[0], paneId);
  if (firstChild.removed) {
    // Collapse this split only when the direct child was removed. If deletion happened deeper in
    // that child subtree, keep this split node and replace just the changed child so sibling panes
    // outside the removed subtree stay visible.
    return {
      layout:
        firstChild.layout === null
          ? layout.children[1]
          : {
              ...layout,
              children: [firstChild.layout, layout.children[1]],
            },
      removed: true,
    };
  }

  const secondChild = removePaneLayout(layout.children[1], paneId);
  if (secondChild.removed) {
    // Same rule as above for the second child: direct child removal promotes the sibling, while a
    // nested removal preserves the current split and swaps in the updated child subtree.
    return {
      layout:
        secondChild.layout === null
          ? layout.children[0]
          : {
              ...layout,
              children: [layout.children[0], secondChild.layout],
            },
      removed: true,
    };
  }

  return { layout, removed: false };
}

/**
 * Updates the split at a child-index path, clamping its ratio to the supported range.
 * An empty path targets the root; paths ending at a leaf or containing invalid indices do nothing.
 */
export function updateSplitRatio(layout: PaneLayout, path: number[], ratio: number): PaneLayout {
  if (layout.type === 'leaf') {
    return layout;
  }

  if (path.length === 0) {
    return {
      ...layout,
      ratio: clampSplitRatio(ratio),
    };
  }

  const [childIndex, ...remainingPath] = path;
  if (childIndex !== 0 && childIndex !== 1) {
    return layout;
  }

  return {
    ...layout,
    children: layout.children.map((child, index) =>
      index === childIndex ? updateSplitRatio(child, remainingPath, ratio) : child,
    ) as [PaneLayout, PaneLayout],
  };
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
