import { describe, expect, it } from 'vitest';
import type { PaneLayout } from './types';
import { countPaneLeaves } from './pane-layout';

describe('countPaneLeaves', () => {
  it('counts a single leaf layout as one pane', () => {
    // Given: a layout with one terminal pane leaf.
    const layout: PaneLayout = {
      type: 'leaf',
      paneId: 'pane-1',
    };

    // When: callers count pane leaves.
    const count = countPaneLeaves(layout);

    // Then: the single leaf is counted as one pane.
    expect(count).toBe(1);
  });

  it('counts all leaves in a nested split layout', () => {
    // Given: a layout tree with nested horizontal and vertical splits.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        {
          type: 'leaf',
          paneId: 'pane-1',
        },
        {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.4,
          children: [
            {
              type: 'leaf',
              paneId: 'pane-2',
            },
            {
              type: 'leaf',
              paneId: 'pane-3',
            },
          ],
        },
      ],
    };

    // When: callers count pane leaves.
    const count = countPaneLeaves(layout);

    // Then: every leaf in the tree is counted.
    expect(count).toBe(3);
  });
});
