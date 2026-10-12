import { describe, expect, it } from 'vite-plus/test';
import { findAdjacentPaneId, type PaneFocusDirection } from './pane-navigation';
import type { PaneLayout } from './types';

function leaf(paneId: string): PaneLayout {
  return { type: 'leaf', paneId };
}

function split(
  direction: 'vertical' | 'horizontal',
  first: PaneLayout,
  second: PaneLayout,
  ratio = 0.5,
): PaneLayout {
  return { type: 'split', direction, ratio, children: [first, second] };
}

describe('findAdjacentPaneId', () => {
  it.each<[PaneFocusDirection, 'vertical' | 'horizontal', string, string]>([
    ['right', 'vertical', 'a', 'b'],
    ['left', 'vertical', 'b', 'a'],
    ['down', 'horizontal', 'a', 'b'],
    ['up', 'horizontal', 'b', 'a'],
  ])('finds the neighbor in direction %s', (direction, axis, active, expected) => {
    // Given: two panes sharing an edge.
    const layout = split(axis, leaf('a'), leaf('b'), 1 / 3);

    // When: the neighbor is resolved.
    const result = findAdjacentPaneId(layout, active, direction);

    // Then: the facing pane is selected despite fractional coordinates.
    expect(result).toBe(expected);
  });

  it('prefers the candidate with the largest perpendicular overlap', () => {
    // Given: a full-height left pane facing unequal right-side panes.
    const layout = split(
      'vertical',
      leaf('active'),
      split('horizontal', leaf('top'), leaf('bottom'), 0.8),
    );

    // When: navigation moves right.
    const result = findAdjacentPaneId(layout, 'active', 'right');

    // Then: the taller candidate wins.
    expect(result).toBe('top');
  });

  it('prefers the nearest center when overlaps are equal', () => {
    // Given: the active pane spans 0-65% of the height and faces right-top (0-30%) and
    // right-middle (30-60%) with an equal 30% overlap; right-middle's center is closer.
    const layout = split(
      'vertical',
      split('horizontal', leaf('active'), leaf('left-bottom'), 0.65),
      split(
        'horizontal',
        leaf('right-top'),
        split('horizontal', leaf('right-middle'), leaf('right-bottom'), 3 / 7),
        0.3,
      ),
    );

    // When: navigation moves right.
    const result = findAdjacentPaneId(layout, 'active', 'right');

    // Then: distance wins over depth-first order.
    expect(result).toBe('right-middle');
  });

  it('retains depth-first order when overlap and distance are equal', () => {
    // Given: symmetric candidates facing a pane spanning their combined height.
    const layout = split(
      'vertical',
      leaf('active'),
      split('horizontal', leaf('top'), leaf('bottom')),
    );

    // When: navigation moves right.
    const result = findAdjacentPaneId(layout, 'active', 'right');

    // Then: the first leaf wins the complete tie.
    expect(result).toBe('top');
  });

  it('selects the pane sharing the facing edge in a quadrant layout', () => {
    // Given: four equal quadrants, where bottom-right also touches top-left's right edge at a
    // corner.
    const layout = split(
      'vertical',
      split('horizontal', leaf('top-left'), leaf('bottom-left')),
      split('horizontal', leaf('top-right'), leaf('bottom-right')),
    );

    // When: the top-left pane moves right.
    const result = findAdjacentPaneId(layout, 'top-left', 'right');

    // Then: the pane sharing the edge is selected.
    expect(result).toBe('top-right');
  });

  it.each<PaneFocusDirection>(['left', 'right', 'up', 'down'])(
    'returns null for a lone pane moving %s',
    (direction) => {
      // Given: a single-pane layout.
      const layout = leaf('only');

      // When: navigation is requested.
      const result = findAdjacentPaneId(layout, 'only', direction);

      // Then: navigation never wraps or selects the active pane.
      expect(result).toBeNull();
    },
  );

  it('does not wrap at an outer edge or resolve an unknown active pane', () => {
    // Given: a left/right split.
    const layout = split('vertical', leaf('a'), leaf('b'));

    // When: navigation targets an outer edge or starts from a missing pane.
    const results = [
      findAdjacentPaneId(layout, 'a', 'left'),
      findAdjacentPaneId(layout, 'missing', 'right'),
    ];

    // Then: neither request has a neighbor.
    expect(results).toEqual([null, null]);
  });
});
