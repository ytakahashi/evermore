import { flattenLayout, type PaneRect } from './pane-layout';
import type { PaneLayout } from './types';

export type PaneFocusDirection = 'left' | 'right' | 'up' | 'down';

/**
 * Tolerance for comparing pane edge positions in container-percentage units. `flattenLayout`
 * produces values derived from float multiplication on `ratio`, so exact equality cannot be
 * assumed; 0.01 percentage points is well below any pane size the renderer can produce.
 */
const PANE_EDGE_EPSILON_PCT = 0.01;

function rectsTouch(active: PaneRect, candidate: PaneRect, direction: PaneFocusDirection): boolean {
  switch (direction) {
    case 'left':
      return (
        Math.abs(candidate.leftPct + candidate.widthPct - active.leftPct) <= PANE_EDGE_EPSILON_PCT
      );
    case 'right':
      return (
        Math.abs(candidate.leftPct - (active.leftPct + active.widthPct)) <= PANE_EDGE_EPSILON_PCT
      );
    case 'up':
      return (
        Math.abs(candidate.topPct + candidate.heightPct - active.topPct) <= PANE_EDGE_EPSILON_PCT
      );
    case 'down':
      return (
        Math.abs(candidate.topPct - (active.topPct + active.heightPct)) <= PANE_EDGE_EPSILON_PCT
      );
  }
}

function perpendicularOverlap(
  active: PaneRect,
  candidate: PaneRect,
  direction: PaneFocusDirection,
): number {
  if (direction === 'left' || direction === 'right') {
    const top = Math.max(active.topPct, candidate.topPct);
    const bottom = Math.min(
      active.topPct + active.heightPct,
      candidate.topPct + candidate.heightPct,
    );
    return bottom - top;
  }
  const left = Math.max(active.leftPct, candidate.leftPct);
  const right = Math.min(active.leftPct + active.widthPct, candidate.leftPct + candidate.widthPct);
  return right - left;
}

function centerDistance(a: PaneRect, b: PaneRect): number {
  const ax = a.leftPct + a.widthPct / 2;
  const ay = a.topPct + a.heightPct / 2;
  const bx = b.leftPct + b.widthPct / 2;
  const by = b.topPct + b.heightPct / 2;
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Returns the pane id geometrically adjacent to `activePaneId` in `direction`, or `null` when no
 * candidate touches the active pane's facing edge. Candidates need positive perpendicular overlap
 * beyond the edge tolerance. Larger overlap wins, then smaller center distance; remaining ties
 * retain depth-first layout order. Navigation never wraps.
 */
export function findAdjacentPaneId(
  layout: PaneLayout,
  activePaneId: string,
  direction: PaneFocusDirection,
): string | null {
  const { panes } = flattenLayout(layout);
  const activeRect = panes.find((rect) => rect.paneId === activePaneId);
  if (!activeRect) {
    return null;
  }

  let best: { paneId: string; overlap: number; distance: number } | null = null;
  for (const candidate of panes) {
    if (candidate.paneId === activePaneId) {
      continue;
    }
    if (!rectsTouch(activeRect, candidate, direction)) {
      continue;
    }
    const overlap = perpendicularOverlap(activeRect, candidate, direction);
    // Defensive: in a binary split layout every internal edge also faces a pane with positive
    // overlap, so a corner-only candidate never wins on overlap anyway. The filter keeps a
    // zero-overlap candidate from being returned if that geometric guarantee ever changes.
    if (overlap <= PANE_EDGE_EPSILON_PCT) {
      continue;
    }
    const distance = centerDistance(activeRect, candidate);
    if (
      !best ||
      overlap > best.overlap + PANE_EDGE_EPSILON_PCT ||
      (Math.abs(overlap - best.overlap) <= PANE_EDGE_EPSILON_PCT && distance < best.distance)
    ) {
      best = { paneId: candidate.paneId, overlap, distance };
    }
  }

  return best?.paneId ?? null;
}
