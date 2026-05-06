import { describe, expect, it } from 'vitest';
import type { PaneLayout } from './types';
import { countPaneLeaves, flattenLayout } from './pane-layout';

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

describe('flattenLayout', () => {
  it('places a single leaf as the entire container with no splits', () => {
    // Given: a layout with one terminal pane leaf.
    const layout: PaneLayout = { type: 'leaf', paneId: 'pane-1' };

    // When: the layout is flattened.
    const flattened = flattenLayout(layout);

    // Then: the lone pane fills the container and no splits are emitted.
    expect(flattened.panes).toEqual([
      { paneId: 'pane-1', leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 },
    ]);
    expect(flattened.splits).toEqual([]);
  });

  it('flattens a vertical split with ratio 0.5 into left and right halves', () => {
    // Given: a vertical split (left/right children) at ratio 0.5.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', paneId: 'pane-l' },
        { type: 'leaf', paneId: 'pane-r' },
      ],
    };

    // When: the layout is flattened.
    const flattened = flattenLayout(layout);

    // Then: panes split the width 50/50 and one root split is reported.
    expect(flattened.panes).toEqual([
      { paneId: 'pane-l', leftPct: 0, topPct: 0, widthPct: 50, heightPct: 100 },
      { paneId: 'pane-r', leftPct: 50, topPct: 0, widthPct: 50, heightPct: 100 },
    ]);
    expect(flattened.splits).toEqual([
      {
        path: [],
        direction: 'vertical',
        ratio: 0.5,
        leftPct: 0,
        topPct: 0,
        widthPct: 100,
        heightPct: 100,
      },
    ]);
  });

  it('flattens a horizontal split with ratio 0.7 into top 70% and bottom 30%', () => {
    // Given: a horizontal split (top/bottom children) at ratio 0.7.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.7,
      children: [
        { type: 'leaf', paneId: 'pane-top' },
        { type: 'leaf', paneId: 'pane-bottom' },
      ],
    };

    // When: the layout is flattened.
    const flattened = flattenLayout(layout);

    // Then: top pane has height 70 and bottom pane fills the remaining 30.
    expect(flattened.panes).toEqual([
      { paneId: 'pane-top', leftPct: 0, topPct: 0, widthPct: 100, heightPct: 70 },
      { paneId: 'pane-bottom', leftPct: 0, topPct: 70, widthPct: 100, heightPct: 30 },
    ]);
    expect(flattened.splits).toEqual([
      {
        path: [],
        direction: 'horizontal',
        ratio: 0.7,
        leftPct: 0,
        topPct: 0,
        widthPct: 100,
        heightPct: 100,
      },
    ]);
  });

  it('flattens a nested mixed split into per-leaf rects with correct paths', () => {
    // Given: a vertical root split whose right child is itself a horizontal split.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', paneId: 'pane-l' },
        {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.4,
          children: [
            { type: 'leaf', paneId: 'pane-rt' },
            { type: 'leaf', paneId: 'pane-rb' },
          ],
        },
      ],
    };

    // When: the layout is flattened.
    const flattened = flattenLayout(layout);

    // Then: each leaf has the expected rect, and split paths follow [children index, ...] order.
    expect(flattened.panes).toEqual([
      { paneId: 'pane-l', leftPct: 0, topPct: 0, widthPct: 50, heightPct: 100 },
      { paneId: 'pane-rt', leftPct: 50, topPct: 0, widthPct: 50, heightPct: 40 },
      { paneId: 'pane-rb', leftPct: 50, topPct: 40, widthPct: 50, heightPct: 60 },
    ]);
    expect(flattened.splits).toEqual([
      {
        path: [],
        direction: 'vertical',
        ratio: 0.5,
        leftPct: 0,
        topPct: 0,
        widthPct: 100,
        heightPct: 100,
      },
      {
        path: [1],
        direction: 'horizontal',
        ratio: 0.4,
        leftPct: 50,
        topPct: 0,
        widthPct: 50,
        heightPct: 100,
      },
    ]);
  });

  it('respects asymmetric ratios at multiple depths', () => {
    // Given: a vertical root with ratio 0.3 whose left child is a horizontal split with ratio 0.8.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.3,
      children: [
        {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.8,
          children: [
            { type: 'leaf', paneId: 'pane-lt' },
            { type: 'leaf', paneId: 'pane-lb' },
          ],
        },
        { type: 'leaf', paneId: 'pane-r' },
      ],
    };

    // When: the layout is flattened.
    const flattened = flattenLayout(layout);

    // Then: the left column has width 30, divided 80/20 vertically; the right column fills 70.
    expect(flattened.panes).toEqual([
      {
        paneId: 'pane-lt',
        leftPct: 0,
        topPct: 0,
        widthPct: 30,
        heightPct: 80,
      },
      {
        paneId: 'pane-lb',
        leftPct: 0,
        topPct: 80,
        widthPct: 30,
        heightPct: 20,
      },
      {
        paneId: 'pane-r',
        leftPct: 30,
        topPct: 0,
        widthPct: 70,
        heightPct: 100,
      },
    ]);
    expect(flattened.splits.map((split) => split.path)).toEqual([[], [0]]);
  });
});
