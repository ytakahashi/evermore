import { describe, expect, it } from 'vitest';
import { resolveDropEdge, toInsertIndex, toReorderIndex, type Bounds } from './tabDnd';

const horizontalBounds: Bounds = { left: 100, right: 200, top: 0, bottom: 30 };
const verticalBounds: Bounds = { left: 0, right: 200, top: 100, bottom: 140 };

describe('resolveDropEdge', () => {
  it('treats the leading half of a horizontal element as "before"', () => {
    // Given: a pointer left of the horizontal midpoint (150).
    // When / Then: the drop lands before the hovered tab.
    expect(resolveDropEdge('horizontal', { x: 120, y: 15 }, horizontalBounds)).toBe('before');
  });

  it('treats the trailing half of a horizontal element as "after"', () => {
    // Given: a pointer right of the horizontal midpoint (150).
    // When / Then: the drop lands after the hovered tab.
    expect(resolveDropEdge('horizontal', { x: 180, y: 15 }, horizontalBounds)).toBe('after');
  });

  it('uses the vertical axis when the list is vertical', () => {
    // Given: pointers above and below the vertical midpoint (120).
    // When / Then: only the y coordinate decides the edge.
    expect(resolveDropEdge('vertical', { x: 10, y: 110 }, verticalBounds)).toBe('before');
    expect(resolveDropEdge('vertical', { x: 10, y: 130 }, verticalBounds)).toBe('after');
  });
});

describe('toReorderIndex', () => {
  it('keeps the index when inserting before a later tab (gap closes)', () => {
    // Given: tab at index 0 dropped before the tab displayed at index 2.
    // When / Then: removing index 0 shifts the target left by one.
    expect(toReorderIndex(0, 2, 'before')).toBe(1);
  });

  it('accounts for the closed gap when inserting after a later tab', () => {
    // Given: tab at index 0 dropped after the tab displayed at index 2.
    expect(toReorderIndex(0, 2, 'after')).toBe(2);
  });

  it('does not shift when inserting before an earlier tab', () => {
    // Given: tab at index 3 dropped before the tab displayed at index 1.
    expect(toReorderIndex(3, 1, 'before')).toBe(1);
  });

  it('resolves a self-drop back to the current index (a no-op for reorder)', () => {
    // Given: a tab dropped onto either edge of its own slot.
    expect(toReorderIndex(2, 2, 'before')).toBe(2);
    expect(toReorderIndex(2, 2, 'after')).toBe(2);
  });
});

describe('toInsertIndex', () => {
  it('inserts at the hovered index when dropping before it', () => {
    // Given: a cross-workspace tab dropped on the leading edge of the tab at index 2.
    // When / Then: no shift compensation applies, so it lands at index 2.
    expect(toInsertIndex(2, 'before')).toBe(2);
  });

  it('inserts after the hovered index when dropping after it', () => {
    // Given: a cross-workspace tab dropped on the trailing edge of the tab at index 2.
    // When / Then: it lands one slot later, at index 3.
    expect(toInsertIndex(2, 'after')).toBe(3);
  });

  it('maps a drop after the first tab to index one (head insert otherwise)', () => {
    // Given: drops on either edge of the first tab.
    expect(toInsertIndex(0, 'before')).toBe(0);
    expect(toInsertIndex(0, 'after')).toBe(1);
  });
});
