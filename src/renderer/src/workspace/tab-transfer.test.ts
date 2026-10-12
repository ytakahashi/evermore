import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import { transferTab, prepareTabTransfer, type TransferTabOptions } from './tab-transfer';

function createWorkspace(id: string, names: string[]): Workspace {
  return {
    id,
    name: id,
    rootPath: '/project',
    tabs: names.map((name) => ({
      id: `${id}-${name}`,
      name,
      isCustomName: true,
      layout: { type: 'leaf', paneId: `${id}-${name}-pane` },
      activePaneId: `${id}-${name}-pane`,
    })),
    panes: names.map((name) => ({ id: `${id}-${name}-pane`, cwd: `/project/${name}` })),
    activeTabId: `${id}-${names[0]}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

function options(toIndex?: number): TransferTabOptions {
  return { movedTabId: 'source-a', paneIdByOldId: new Map<string, string>(), toIndex };
}

describe('prepareTabTransfer', () => {
  it('lists distinct pane ids in depth-first order', () => {
    // Given: a moving split tab with an ordered list of leaves.
    const source = createWorkspace('source', ['a', 'b']);
    source.tabs[0] = {
      ...source.tabs[0],
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.4,
        children: [
          { type: 'leaf', paneId: 'source-a-pane' },
          { type: 'leaf', paneId: 'extra' },
        ],
      },
    };
    const target = createWorkspace('target', ['x']);
    const before = structuredClone([source, target]);

    // When: transfer preparation is requested.
    const result = prepareTabTransfer(source, target, 'source-a');

    // Then: the caller can allocate ids in layout order, without changing either workspace.
    expect(result).toEqual({ tabId: 'source-a', paneIds: ['source-a-pane', 'extra'] });
    expect([source, target]).toEqual(before);
  });

  it.each(['same', 'final', 'missing'])('refuses a %s transfer', (reason) => {
    // Given: a same-workspace move, final tab, or missing tab.
    const source = createWorkspace('source', reason === 'final' ? ['a'] : ['a', 'b']);
    const target = reason === 'same' ? source : createWorkspace('target', ['x']);
    const tabId = reason === 'missing' ? 'missing' : 'source-a';
    const before = structuredClone([source, target]);

    // When: preparation and the transformation are requested.
    const prepared = prepareTabTransfer(source, target, tabId);
    const result = transferTab(source, target, tabId, options());

    // Then: neither permits a transfer, and both inputs remain unchanged.
    expect(prepared).toBeNull();
    expect(result).toBeNull();
    expect([source, target]).toEqual(before);
  });
});

describe('transferTab', () => {
  it('moves every owned pane, remaps nested references and selection, and preserves runtime fields', () => {
    // Given: a moving split tab, an unrelated source tab, and explicit replacement ids.
    const source = createWorkspace('source', ['a', 'b']);
    source.tabs[0] = {
      ...source.tabs[0],
      activePaneId: 'extra',
      layout: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.4,
        children: [
          { type: 'leaf', paneId: 'source-a-pane' },
          { type: 'leaf', paneId: 'extra' },
        ],
      },
    };
    source.panes.push({
      id: 'extra',
      cwd: '/extra',
      ptyId: 'pty-extra',
      initialCommand: 'ssh dev',
    });
    const target = createWorkspace('target', ['x']);
    const ids = new Map([
      ['source-a-pane', 'new-a'],
      ['extra', 'new-extra'],
    ]);
    const before = structuredClone([source, target]);
    const beforeIds = new Map(ids);

    // When: the moving tab is transferred.
    const result = transferTab(source, target, 'source-a', {
      movedTabId: 'new-tab',
      paneIdByOldId: ids,
    });

    // Then: all owned panes leave the source, whose next tab becomes active.
    expect(result?.source).toEqual({
      ...before[0],
      tabs: [before[0].tabs[1]],
      panes: [before[0].panes[1]],
      activeTabId: 'source-b',
    });
    expect(result?.target.tabs[1]).toEqual({
      ...before[0].tabs[0],
      id: 'new-tab',
      activePaneId: 'new-extra',
      layout: {
        ...before[0].tabs[0].layout,
        children: [
          { type: 'leaf', paneId: 'new-a' },
          { type: 'leaf', paneId: 'new-extra' },
        ],
      },
    });
    expect(result?.target.panes).toEqual([
      ...before[1].panes,
      { ...before[0].panes[0], id: 'new-a' },
      { ...before[0].panes[2], id: 'new-extra' },
    ]);
    expect(result?.target.activeTabId).toBe('new-tab');
    expect(result?.target.updatedAt).toBe(before[1].updatedAt);
    expect([source, target]).toEqual(before);
    expect(ids).toEqual(beforeIds);
  });

  it('preserves source selection when moving an inactive tab and retains a null moved selection', () => {
    // Given: the second source tab is inactive and has no selected pane.
    const source = createWorkspace('source', ['a', 'b']);
    source.tabs[1] = { ...source.tabs[1], activePaneId: null };
    const target = createWorkspace('target', ['x']);

    // When: the second tab is moved.
    const result = transferTab(source, target, 'source-b', {
      ...options(),
      movedTabId: 'source-b',
    });

    // Then: destination selection changes while source selection and the moved tab's null pane remain.
    expect(result?.source.activeTabId).toBe('source-a');
    expect(result?.target.activeTabId).toBe('source-b');
    expect(result?.target.tabs[1]?.activePaneId).toBeNull();
  });

  it('falls back to the previous source tab when the last active tab moves', () => {
    // Given: the last source tab is active.
    const source = { ...createWorkspace('source', ['a', 'b']), activeTabId: 'source-b' };
    const target = createWorkspace('target', ['x']);

    // When: the last tab moves.
    const result = transferTab(source, target, 'source-b', {
      ...options(),
      movedTabId: 'source-b',
    });

    // Then: the previous source tab becomes active.
    expect(result?.source.activeTabId).toBe('source-a');
  });

  it.each([
    { index: 1, expected: ['target-x', 'source-a', 'target-y', 'target-z'] },
    { index: 0, expected: ['source-a', 'target-x', 'target-y', 'target-z'] },
    { index: -5, expected: ['source-a', 'target-x', 'target-y', 'target-z'] },
    { index: 99, expected: ['target-x', 'target-y', 'target-z', 'source-a'] },
    { index: undefined, expected: ['target-x', 'target-y', 'target-z', 'source-a'] },
  ])('inserts at $index, clamping to the target list', ({ index, expected }) => {
    // Given: a source with two tabs and a target with three.
    const source = createWorkspace('source', ['a', 'b']);
    const target = createWorkspace('target', ['x', 'y', 'z']);
    const before = structuredClone([source, target]);

    // When: a tab is moved to the requested index.
    const result = transferTab(source, target, 'source-a', options(index));

    // Then: insertion changes only the returned snapshots.
    expect(result?.target.tabs.map((tab) => tab.id)).toEqual(expected);
    expect(result?.target.activeTabId).toBe('source-a');
    expect([source, target]).toEqual(before);
  });

  it.each(['tab', 'pane', 'duplicate-replacement'])(
    'refuses a %s id collision in explicit ids',
    (kind) => {
      // Given: explicit ids that cannot safely be merged into the destination.
      const source = createWorkspace('source', ['a', 'b']);
      const target = createWorkspace('target', ['x']);
      const ids = new Map<string, string>();
      if (kind === 'pane') ids.set('source-a-pane', 'target-x-pane');
      if (kind === 'duplicate-replacement') {
        source.tabs[0] = {
          ...source.tabs[0],
          layout: {
            type: 'split',
            direction: 'vertical',
            ratio: 0.5,
            children: [
              { type: 'leaf', paneId: 'source-a-pane' },
              { type: 'leaf', paneId: 'extra' },
            ],
          },
        };
        source.panes.push({ id: 'extra', cwd: '/extra' });
        ids.set('extra', 'source-a-pane');
      }
      const before = structuredClone([source, target]);

      // When: the invalid ids are applied.
      const result = transferTab(source, target, 'source-a', {
        movedTabId: kind === 'tab' ? 'target-x' : 'source-a',
        paneIdByOldId: ids,
      });

      // Then: the merge is refused without input mutation.
      expect(result).toBeNull();
      expect([source, target]).toEqual(before);
    },
  );
});
