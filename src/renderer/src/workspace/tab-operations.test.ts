import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import { MAX_WORKSPACE_TABS } from '../../../shared/workspace-constants';
import { extractPaneToTab, preparePaneExtraction, removeTab, reorderTab } from './tab-operations';

function createWorkspace(): Workspace {
  return {
    id: 'workspace',
    name: 'Workspace',
    rootPath: '/project',
    tabs: ['a', 'b', 'c'].map((id) => ({
      id,
      name: id,
      isCustomName: false,
      layout: { type: 'leaf', paneId: `pane-${id}` },
      activePaneId: `pane-${id}`,
    })),
    panes: ['a', 'b', 'c'].map((id) => ({ id: `pane-${id}`, cwd: `/project/${id}` })),
    activeTabId: 'b',
    createdAt: 1,
    updatedAt: 1,
  };
}

function createSplitWorkspace(): Workspace {
  const workspace = createWorkspace();
  workspace.tabs[0] = {
    ...workspace.tabs[0],
    name: 'a',
    activePaneId: 'pane-a',
    layout: {
      type: 'split',
      direction: 'vertical',
      ratio: 0.4,
      children: [
        { type: 'leaf', paneId: 'pane-a' },
        { type: 'leaf', paneId: 'pane-d' },
      ],
    },
  };
  workspace.panes.push({
    id: 'pane-d',
    cwd: '/project/d',
    ptyId: 'pty-d',
    initialCommand: 'ssh dev',
  });
  return workspace;
}

describe('removeTab', () => {
  it.each([
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'b'],
  ])('selects %s successor %s when the active tab closes', (tabId, expected) => {
    // Given: three tabs with the closing tab active.
    const workspace = { ...createWorkspace(), activeTabId: tabId };
    const before = structuredClone(workspace);

    // When: the active tab is closed.
    const result = removeTab(workspace, tabId);

    // Then: selection uses the vacated index, falling back at the end, without mutating the input.
    expect(result?.activeTabId).toBe(expected);
    expect(result?.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c'].filter((id) => id !== tabId));
    expect(result?.panes.map((pane) => pane.id)).toEqual(
      ['a', 'b', 'c'].filter((id) => id !== tabId).map((id) => `pane-${id}`),
    );
    expect(result?.updatedAt).toBe(before.updatedAt);
    expect(workspace).toEqual(before);
  });

  it('removes all panes owned by an inactive split tab while preserving other tabs', () => {
    // Given: an inactive split tab owns two panes.
    const workspace = createSplitWorkspace();
    const before = structuredClone(workspace);

    // When: the split tab is closed.
    const result = removeTab(workspace, 'a');

    // Then: both owned panes disappear and the active tab and its siblings survive.
    expect(result?.tabs).toEqual(before.tabs.slice(1));
    expect(result?.panes).toEqual(
      before.panes.filter((pane) => !['pane-a', 'pane-d'].includes(pane.id)),
    );
    expect(result?.activeTabId).toBe('b');
    expect(workspace).toEqual(before);
  });

  it('refuses missing tabs and protects the final tab', () => {
    // Given: a multi-tab workspace and a workspace containing only its first tab.
    const workspace = createWorkspace();
    const single = {
      ...workspace,
      tabs: workspace.tabs.slice(0, 1),
      panes: workspace.panes.slice(0, 1),
      activeTabId: 'a',
    };
    const before = structuredClone([workspace, single]);

    // When: a missing tab or the final tab is closed.
    const results = [removeTab(workspace, 'missing'), removeTab(single, 'a')];

    // Then: both actions are refused without input changes.
    expect(results).toEqual([null, null]);
    expect([workspace, single]).toEqual(before);
  });
});

describe('reorderTab', () => {
  it.each<[string, number, string[]]>([
    ['a', 2, ['b', 'c', 'a']],
    ['c', 0, ['c', 'a', 'b']],
    ['b', -1, ['b', 'a', 'c']],
    ['b', 99, ['a', 'c', 'b']],
  ])('moves %s to index %s with clamping', (tabId, index, expected) => {
    // Given: a three-tab workspace.
    const workspace = createWorkspace();
    const before = structuredClone(workspace);

    // When: the tab is reordered.
    const result = reorderTab(workspace, tabId, index);

    // Then: only tab order changes and the input stays intact.
    expect(result?.tabs.map((tab) => tab.id)).toEqual(expected);
    expect(result?.activeTabId).toBe(before.activeTabId);
    expect(result?.panes).toBe(workspace.panes);
    expect(result?.updatedAt).toBe(before.updatedAt);
    expect(workspace).toEqual(before);
  });

  it.each<[string, number]>([
    ['a', -1],
    ['c', 99],
    ['b', 1],
    ['missing', 0],
  ])('returns null for unchanged or missing tab %s', (tabId, index) => {
    // Given: a three-tab workspace.
    const workspace = createWorkspace();
    const before = structuredClone(workspace);

    // When: the destination clamps to the current position or the tab is missing.
    const result = reorderTab(workspace, tabId, index);

    // Then: nothing changes.
    expect(result).toBeNull();
    expect(workspace).toEqual(before);
  });
});

describe('extractPaneToTab', () => {
  it('appends an active destination tab while retaining pane objects and runtime fields', () => {
    // Given: a split tab containing a non-active pane with a live terminal.
    const workspace = createSplitWorkspace();
    const before = structuredClone(workspace);

    // When: the non-active pane is detached into a new tab.
    const result = extractPaneToTab(workspace, 'a', 'pane-d', 'new-tab');

    // Then: the source selection is retained and the destination is named from the moved pane cwd.
    expect(result?.tabs[0]).toEqual({
      ...before.tabs[0],
      layout: { type: 'leaf', paneId: 'pane-a' },
    });
    expect(result?.tabs.slice(1, 3)).toEqual(before.tabs.slice(1));
    expect(result?.tabs[3]).toEqual({
      id: 'new-tab',
      name: 'd',
      isCustomName: false,
      layout: { type: 'leaf', paneId: 'pane-d' },
      activePaneId: 'pane-d',
    });
    expect(result?.activeTabId).toBe('new-tab');
    expect(result?.panes).toBe(workspace.panes);
    expect(result?.panes[3]).toBe(workspace.panes[3]);
    expect(result?.updatedAt).toBe(before.updatedAt);
    expect(workspace).toEqual(before);
  });

  it.each(['pane-a', 'missing', null])(
    'repairs source selection %s and synchronizes its automatic name',
    (activePaneId) => {
      // Given: a source selection that is detached, stale, or absent.
      const workspace = createSplitWorkspace();
      workspace.tabs[0] = { ...workspace.tabs[0], activePaneId, name: 'old' };
      const before = structuredClone(workspace);

      // When: the first pane is detached.
      const result = extractPaneToTab(workspace, 'a', 'pane-a', 'new-tab');

      // Then: the surviving pane becomes active and its cwd sets the source name.
      expect(result?.tabs[0]).toEqual({
        ...before.tabs[0],
        name: 'd',
        activePaneId: 'pane-d',
        layout: { type: 'leaf', paneId: 'pane-d' },
      });
      expect(workspace).toEqual(before);
    },
  );

  it('preserves a custom name when the source active pane changes', () => {
    // Given: a source tab with a custom name.
    const workspace = createSplitWorkspace();
    workspace.tabs[0] = { ...workspace.tabs[0], name: 'Custom', isCustomName: true };

    // When: the active pane is detached.
    const result = extractPaneToTab(workspace, 'a', 'pane-a', 'new-tab');

    // Then: only the selection changes, keeping the custom naming policy.
    expect(result?.tabs[0]?.name).toBe('Custom');
    expect(result?.tabs[0]?.isCustomName).toBe(true);
    expect(result?.tabs[0]?.activePaneId).toBe('pane-d');
  });

  it.each([
    'missing-tab',
    'missing-pane',
    'unowned-pane',
    'missing-pane-object',
    'single-pane',
    'duplicate',
    'limit',
  ])('refuses %s before id allocation', (reason) => {
    // Given: one of the conditions that prevents creating a tab from a pane.
    const workspace = createSplitWorkspace();
    let tabId = 'a';
    let paneId = 'pane-a';
    if (reason === 'missing-tab') tabId = 'missing';
    if (reason === 'missing-pane') paneId = 'missing';
    if (reason === 'unowned-pane') paneId = 'pane-b';
    if (reason === 'missing-pane-object')
      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId);
    if (reason === 'single-pane') {
      tabId = 'b';
      paneId = 'pane-b';
    }
    if (reason === 'duplicate')
      workspace.tabs[0] = {
        ...workspace.tabs[0],
        layout: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          children: [
            { type: 'leaf', paneId },
            { type: 'leaf', paneId },
          ],
        },
      };
    if (reason === 'limit')
      workspace.tabs = Array.from({ length: MAX_WORKSPACE_TABS }, (_, index) => ({
        ...workspace.tabs[0],
        id: index === 0 ? 'a' : `filler-${index}`,
      }));
    const before = structuredClone(workspace);

    // When: both preparation and the transformation are requested.
    const extraction = preparePaneExtraction(workspace, tabId, paneId);
    const result = extractPaneToTab(workspace, tabId, paneId, 'new-tab');

    // Then: both agree that the operation is refused and the input is unchanged.
    expect(extraction).toBeNull();
    expect(result).toBeNull();
    expect(workspace).toEqual(before);
  });

  it('refuses a caller-supplied tab id that already exists in the workspace', () => {
    // Given: an extractable pane and a destination id colliding with an existing tab.
    const workspace = createSplitWorkspace();
    const before = structuredClone(workspace);

    // When: the pane is extracted with the colliding id.
    const extraction = preparePaneExtraction(workspace, 'a', 'pane-d');
    const result = extractPaneToTab(workspace, 'a', 'pane-d', 'b');

    // Then: preparation succeeds, but the transformation refuses the duplicate tab id.
    expect(extraction).not.toBeNull();
    expect(result).toBeNull();
    expect(workspace).toEqual(before);
  });
});
