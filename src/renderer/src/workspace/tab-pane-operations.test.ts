import { describe, expect, it } from 'vite-plus/test';
import type { PaneLayout, Tab } from '../../../shared/types';
import { detachPaneFromTab } from './tab-pane-operations';

function createTab(activePaneId: string | null = 'b'): Tab {
  return {
    id: 'tab',
    name: 'unchanged',
    isCustomName: false,
    activePaneId,
    layout: {
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      children: [
        {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.6,
          children: [
            { type: 'leaf', paneId: 'a' },
            { type: 'leaf', paneId: 'b' },
          ],
        },
        { type: 'leaf', paneId: 'c' },
      ],
    },
  };
}

describe('detachPaneFromTab', () => {
  it('collapses a nested split and preserves tab metadata without mutating the source', () => {
    // Given: the active pane is nested inside a split with an outer sibling.
    const source = createTab();
    const before = structuredClone(source);

    // When: the nested active pane is detached.
    const result = detachPaneFromTab(source, 'b');

    // Then: only the vacated split collapses, and naming remains the caller's responsibility.
    expect(result).toEqual({
      movedPaneId: 'b',
      updatedSourceTab: {
        ...source,
        activePaneId: 'a',
        layout: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.4,
          children: [
            { type: 'leaf', paneId: 'a' },
            { type: 'leaf', paneId: 'c' },
          ],
        },
      },
    });
    expect(source).toEqual(before);
  });

  it('preserves the active pane when it remains in the layout', () => {
    // Given: the outer sibling is active.
    const source = createTab('c');

    // When: another pane is detached.
    const result = detachPaneFromTab(source, 'b');

    // Then: the existing selection is retained.
    expect(result?.updatedSourceTab.activePaneId).toBe('c');
  });

  it.each([null, 'missing', 'b'])(
    'falls back to the first remaining leaf for selection %s',
    (activePaneId) => {
      // Given: the selection is absent, stale, or about to be detached.
      const source = createTab(activePaneId);

      // When: the nested pane is detached.
      const result = detachPaneFromTab(source, 'b');

      // Then: selection points to the first surviving leaf.
      expect(result?.updatedSourceTab.activePaneId).toBe('a');
    },
  );

  it.each<PaneLayout>([
    { type: 'leaf', paneId: 'b' },
    {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', paneId: 'b' },
        { type: 'leaf', paneId: 'b' },
      ],
    },
    {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [
        { type: 'leaf', paneId: 'a' },
        { type: 'leaf', paneId: 'c' },
      ],
    },
  ])('refuses to detach a sole, duplicated, or missing pane from %j', (layout) => {
    // Given: a layout that does not allow unambiguous detachment while retaining a pane.
    const source = { ...createTab(), layout };
    const before = structuredClone(source);

    // When: detachment is attempted.
    const result = detachPaneFromTab(source, 'b');

    // Then: the operation fails without modifying the tab.
    expect(result).toBeNull();
    expect(source).toEqual(before);
  });
});
