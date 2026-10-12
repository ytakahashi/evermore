import { describe, expect, it } from 'vite-plus/test';
import type { PaneLayout } from './types';
import {
  collectPaneIds,
  countPaneLeaves,
  flattenLayout,
  findFirstPaneId,
  replacePaneLayout,
  removePaneLayout,
  remapPaneLayoutIds,
  updateSplitRatio,
} from './pane-layout';
import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from './pane-layout-constants';

describe('collectPaneIds', () => {
  it('returns pane ids in depth-first layout order', () => {
    // Given: a nested layout with leaves at different depths.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', paneId: 'pane-1' },
        {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          children: [
            { type: 'leaf', paneId: 'pane-2' },
            { type: 'leaf', paneId: 'pane-3' },
          ],
        },
      ],
    };

    // When: pane ids are collected.
    const paneIds = collectPaneIds(layout);

    // Then: every leaf appears once in tree order.
    expect(paneIds).toEqual(['pane-1', 'pane-2', 'pane-3']);
  });
});

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

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId };
}

// Builds a fresh tree per test so an accidental mutation cannot leak into later cases:
//   vertical 0.4 [ horizontal 0.6 [ a, b ], c ]
function createNestedLayout(): Extract<PaneLayout, { type: 'split' }> {
  return {
    type: 'split',
    direction: 'vertical',
    ratio: 0.4,
    children: [
      { type: 'split', direction: 'horizontal', ratio: 0.6, children: [leaf('a'), leaf('b')] },
      leaf('c'),
    ],
  };
}

describe('findFirstPaneId', () => {
  it('returns the id of a single leaf', () => {
    // Given: a layout with one leaf.
    const layout = leaf('c');

    // When: the first pane is resolved.
    const paneId = findFirstPaneId(layout);

    // Then: the leaf itself is returned.
    expect(paneId).toBe('c');
  });

  it('returns the first leaf in depth-first order for a nested tree', () => {
    // Given: a nested split whose first child is another split.
    const layout = createNestedLayout();

    // When: the first pane is resolved.
    const paneId = findFirstPaneId(layout);

    // Then: the deepest first child wins.
    expect(paneId).toBe('a');
  });
});

describe('replacePaneLayout', () => {
  it('replaces a nested leaf while preserving siblings and split metadata', () => {
    // Given: a nested tree and a replacement subtree.
    const layout = createNestedLayout();
    const before = structuredClone(layout);
    const replacement: PaneLayout = {
      type: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      children: [leaf('a'), leaf('d')],
    };

    // When: the nested leaf is replaced.
    const updated = replacePaneLayout(layout, 'a', replacement);

    // Then: only the matching leaf changes and the input stays intact.
    expect(updated).toEqual({
      ...before,
      children: [{ ...before.children[0], children: [replacement, leaf('b')] }, leaf('c')],
    });
    expect(layout).toEqual(before);
  });

  it('replaces every matching leaf', () => {
    // Given: a malformed tree referencing the same pane twice.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [leaf('a'), leaf('a')],
    };

    // When: that pane is replaced.
    const updated = replacePaneLayout(layout, 'a', leaf('b'));

    // Then: both occurrences are replaced.
    expect(updated).toEqual({ ...layout, children: [leaf('b'), leaf('b')] });
  });

  it('returns an equal layout when no leaf matches', () => {
    // Given: a nested tree.
    const layout = createNestedLayout();
    const before = structuredClone(layout);

    // When: an absent pane is replaced.
    const updated = replacePaneLayout(layout, 'missing', leaf('d'));

    // Then: the layout values are unchanged.
    expect(updated).toEqual(before);
  });
});

describe('remapPaneLayoutIds', () => {
  it('remaps only ids present in the mapping without mutating the input', () => {
    // Given: a mapping for a nested leaf and an outer sibling.
    const layout = createNestedLayout();
    const before = structuredClone(layout);
    const mapping = new Map([
      ['a', 'new-a'],
      ['c', 'new-c'],
    ]);

    // When: leaf ids are remapped.
    const updated = remapPaneLayoutIds(layout, mapping);

    // Then: unmapped ids and split metadata are preserved.
    expect(updated).toEqual({
      ...before,
      children: [{ ...before.children[0], children: [leaf('new-a'), leaf('b')] }, leaf('new-c')],
    });
    expect(layout).toEqual(before);
  });
});

describe('removePaneLayout', () => {
  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('collapses the nested split when leaf %s is removed', (paneId, survivingPaneId) => {
    // Given: a nested split with an outer sibling.
    const layout = createNestedLayout();
    const before = structuredClone(layout);

    // When: one nested leaf is removed.
    const result = removePaneLayout(layout, paneId);

    // Then: the nested sibling is promoted while the outer split survives.
    expect(result).toEqual({
      layout: { ...before, children: [leaf(survivingPaneId), leaf('c')] },
      removed: true,
    });
    expect(layout).toEqual(before);
  });

  it('preserves the outer split when removal occurs deeper in its second child', () => {
    // Given: the nested split is the second child of the root.
    const nested = createNestedLayout();
    const layout: PaneLayout = { ...nested, children: [nested.children[1], nested.children[0]] };

    // When: a leaf in that subtree is removed.
    const result = removePaneLayout(layout, 'a');

    // Then: the outer sibling survives and only the nested child is replaced.
    expect(result).toEqual({
      layout: { ...layout, children: [leaf('c'), leaf('b')] },
      removed: true,
    });
  });

  it('promotes the sibling subtree when a direct leaf child is removed', () => {
    // Given: a root containing a nested subtree and a leaf.
    const layout = createNestedLayout();

    // When: the direct leaf is removed.
    const result = removePaneLayout(layout, 'c');

    // Then: the complete sibling subtree is promoted by reference.
    expect(result).toEqual({ layout: layout.children[0], removed: true });
    expect(result.layout).toBe(layout.children[0]);
  });

  it('returns a null layout when the root leaf is removed', () => {
    // Given: a single-leaf layout.
    const layout = leaf('a');

    // When: that leaf is removed.
    const result = removePaneLayout(layout, 'a');

    // Then: nothing remains.
    expect(result).toEqual({ layout: null, removed: true });
  });

  it('returns the same layout when the pane is absent', () => {
    // Given: a nested tree.
    const layout = createNestedLayout();

    // When: an absent pane is removed.
    const result = removePaneLayout(layout, 'missing');

    // Then: the input layout is returned as-is.
    expect(result).toEqual({ layout, removed: false });
    expect(result.layout).toBe(layout);
  });

  it('removes only the first matching leaf from a duplicate layout', () => {
    // Given: both children reference the same pane.
    const layout: PaneLayout = {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [leaf('a'), leaf('a')],
    };

    // When: that pane is removed.
    const result = removePaneLayout(layout, 'a');

    // Then: the second occurrence remains.
    expect(result).toEqual({ layout: leaf('a'), removed: true });
  });
});

describe('updateSplitRatio', () => {
  it.each([
    [MIN_SPLIT_RATIO - 0.1, MIN_SPLIT_RATIO],
    [0.62, 0.62],
    [MAX_SPLIT_RATIO + 0.1, MAX_SPLIT_RATIO],
  ])('clamps root ratio %s to %s without mutating the input', (ratio, expected) => {
    // Given: a split at the layout root.
    const layout = createNestedLayout();
    const before = structuredClone(layout);

    // When: the root ratio is updated.
    const updated = updateSplitRatio(layout, [], ratio);

    // Then: the supported bounds are applied and the input stays intact.
    expect(updated).toEqual({ ...before, ratio: expected });
    expect(layout).toEqual(before);
  });

  it.each([0, 1])('updates a nested split at child %s', (index) => {
    // Given: a root whose specified child is a split.
    const nested = createNestedLayout();
    const layout: PaneLayout =
      index === 0 ? nested : { ...nested, children: [nested.children[1], nested.children[0]] };
    const before = structuredClone(layout);
    const path = [index];

    // When: the nested split is resized.
    const updated = updateSplitRatio(layout, path, 0.7);

    // Then: only the targeted split ratio changes and neither the input nor the path is mutated.
    const resized = { ...nested.children[0], ratio: 0.7 };
    expect(updated).toEqual({
      ...before,
      children: index === 0 ? [resized, leaf('c')] : [leaf('c'), resized],
    });
    expect(layout).toEqual(before);
    expect(path).toEqual([index]);
  });

  it.each([[2], [0, -1], [0, 0], [1], [0, 0, 1]].map((path) => ({ path })))(
    'preserves layout values for invalid or leaf path $path',
    ({ path }) => {
      // Given: a path that cannot target a split.
      const layout = createNestedLayout();
      const before = structuredClone(layout);

      // When: resize is requested.
      const updated = updateSplitRatio(layout, path, 0.7);

      // Then: the layout values are unchanged.
      expect(updated).toEqual(before);
    },
  );
});
