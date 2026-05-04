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
