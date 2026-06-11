import { describe, expect, it } from 'vitest';
import { MAX_SPLIT_RATIO, MIN_SPLIT_RATIO } from '../../shared/pane-layout-constants';
import type { Pane, PaneLayout, Workspace } from '../../shared/types';
import {
  MAX_COMMAND_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PATH_LENGTH,
} from '../ipc/validation';
import {
  MAX_LAYOUT_DEPTH,
  MAX_WORKSPACE_PANES,
  MAX_WORKSPACE_TABS,
  readWorkspace,
} from './validate-workspace';

const CHANNEL = 'workspace:update';

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'Project',
    rootPath: '/Users/tester/project',
    tabs: [
      {
        id: 'tab-1',
        name: 'zsh',
        layout: { type: 'leaf', paneId: 'pane-1' },
        activePaneId: 'pane-1',
      },
    ],
    panes: [{ id: 'pane-1', cwd: '/Users/tester/project' }],
    activeTabId: 'tab-1',
    createdAt: 1_000,
    updatedAt: 2_000,
  };
}

function createNestedWorkspace(): Workspace {
  return {
    ...createWorkspace(),
    tabs: [
      {
        id: 'tab-1',
        name: 'zsh',
        layout: {
          type: 'split',
          direction: 'vertical',
          ratio: 0.5,
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            {
              type: 'split',
              direction: 'horizontal',
              ratio: 0.6,
              children: [
                { type: 'leaf', paneId: 'pane-2' },
                { type: 'leaf', paneId: 'pane-3' },
              ],
            },
          ],
        },
        activePaneId: 'pane-2',
      },
    ],
    panes: [
      { id: 'pane-1', cwd: '/Users/tester/project' },
      { id: 'pane-2', cwd: '/Users/tester/project' },
      { id: 'pane-3', cwd: '/Users/tester/project' },
    ],
  };
}

function createDeepWorkspace(depth: number): Workspace {
  const panes: Pane[] = [];
  let nextPane = 0;

  const createLeaf = (): PaneLayout => {
    const paneId = `pane-${nextPane}`;
    nextPane += 1;
    panes.push({ id: paneId, cwd: '/Users/tester/project' });
    return { type: 'leaf', paneId };
  };

  const createLayout = (remainingDepth: number): PaneLayout => {
    if (remainingDepth === 0) {
      return createLeaf();
    }

    return {
      type: 'split',
      direction: 'vertical',
      ratio: 0.5,
      children: [createLeaf(), createLayout(remainingDepth - 1)],
    };
  };

  return {
    ...createWorkspace(),
    tabs: [
      {
        id: 'tab-1',
        name: 'zsh',
        layout: createLayout(depth),
        activePaneId: 'pane-0',
      },
    ],
    panes,
  };
}

function expectInvalidWorkspace(value: unknown): void {
  expect(() => readWorkspace(value, CHANNEL)).toThrow(`Invalid IPC payload for ${CHANNEL}`);
}

describe('readWorkspace', () => {
  it('reads a representative valid single-pane workspace', () => {
    // Given: a valid renderer workspace snapshot.
    const workspace = createWorkspace();

    // When: the snapshot is validated.
    const result = readWorkspace(workspace, CHANNEL);

    // Then: an equivalent reconstructed workspace is returned.
    expect(result).toEqual(workspace);
    expect(result).not.toBe(workspace);
  });

  it('reads a valid nested split workspace', () => {
    // Given: a valid nested split workspace.
    const workspace = createNestedWorkspace();

    // When / Then: every nested layout node is accepted and reconstructed.
    expect(readWorkspace(workspace, CHANNEL)).toEqual(workspace);
  });

  it('accepts runtime pane fields while removing unknown fields throughout the result', () => {
    // Given: a valid workspace with runtime fields and unknown renderer-controlled keys.
    const value = {
      ...createWorkspace(),
      unknownWorkspace: true,
      tabs: [
        {
          ...createWorkspace().tabs[0],
          unknownTab: true,
          layout: {
            type: 'leaf',
            paneId: 'pane-1',
            unknownLayout: true,
          },
        },
      ],
      panes: [
        {
          id: 'pane-1',
          cwd: '/Users/tester/project',
          ptyId: 'pty-1',
          initialCommand: 'pnpm test',
          unknownPane: true,
        },
      ],
    };

    // When: the snapshot is validated.
    const result = readWorkspace(value, CHANNEL);

    // Then: runtime fields survive, while unknown keys are absent from reconstructed objects.
    expect(result.panes[0]).toEqual({
      id: 'pane-1',
      cwd: '/Users/tester/project',
      ptyId: 'pty-1',
      initialCommand: 'pnpm test',
    });
    expect(result).not.toHaveProperty('unknownWorkspace');
    expect(result.tabs[0]).not.toHaveProperty('unknownTab');
    expect(result.tabs[0]?.layout).not.toHaveProperty('unknownLayout');
    expect(result.panes[0]).not.toHaveProperty('unknownPane');
  });

  it.each([
    [
      'duplicate tab ids',
      { tabs: [{ ...createWorkspace().tabs[0] }, { ...createWorkspace().tabs[0] }] },
    ],
    [
      'duplicate pane ids',
      {
        panes: [
          { id: 'pane-1', cwd: '/Users/tester/project' },
          { id: 'pane-1', cwd: '/Users/tester/project' },
        ],
      },
    ],
    ['empty tabs', { tabs: [] }],
    ['empty panes', { panes: [] }],
    ['over-limit tabs', { tabs: Array(MAX_WORKSPACE_TABS + 1).fill(createWorkspace().tabs[0]) }],
    [
      'over-limit panes',
      { panes: Array(MAX_WORKSPACE_PANES + 1).fill(createWorkspace().panes[0]) },
    ],
    ['invalid active tab', { activeTabId: 'missing-tab' }],
    ['negative createdAt', { createdAt: -1 }],
    ['NaN updatedAt', { updatedAt: Number.NaN }],
    ['infinite updatedAt', { updatedAt: Infinity }],
    ['wrong workspace id type', { id: 1 }],
    ['wrong workspace name type', { name: 1 }],
    ['wrong root path type', { rootPath: 1 }],
    ['wrong tabs type', { tabs: {} }],
    ['wrong panes type', { panes: {} }],
    ['wrong active tab type', { activeTabId: 1 }],
    ['wrong createdAt type', { createdAt: '1000' }],
    ['whitespace-only workspace name', { name: '   ' }],
    ['over-limit workspace id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
    ['over-limit workspace name', { name: 'x'.repeat(MAX_NAME_LENGTH + 1) }],
    ['over-limit root path', { rootPath: 'x'.repeat(MAX_PATH_LENGTH + 1) }],
  ])(
    'rejects invalid workspace fields: %s',
    (_label: string, override: Record<string, unknown>) => {
      // Given: a workspace with an invalid top-level field.
      const value = { ...createWorkspace(), ...override };

      // When / Then: the invalid snapshot is rejected.
      expectInvalidWorkspace(value);
    },
  );

  it.each([
    ['whitespace-only tab name', { name: '   ' }],
    ['invalid active pane', { activePaneId: 'missing-pane' }],
    ['wrong tab id type', { id: 1 }],
    ['over-limit tab id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
    ['over-limit tab name', { name: 'x'.repeat(MAX_NAME_LENGTH + 1) }],
  ])('rejects invalid tab fields: %s', (_label: string, tabOverride: Record<string, unknown>) => {
    // Given: a workspace with an invalid tab field.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      tabs: [{ ...workspace.tabs[0], ...tabOverride }],
    };

    // When / Then: the invalid snapshot is rejected.
    expectInvalidWorkspace(value);
  });

  it.each([
    ['wrong pane id type', { id: 1 }],
    ['wrong cwd type', { cwd: 1 }],
    ['over-limit pane id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
    ['over-limit cwd', { cwd: 'x'.repeat(MAX_PATH_LENGTH + 1) }],
    ['empty ptyId', { ptyId: '' }],
    ['over-limit ptyId', { ptyId: 'x'.repeat(MAX_ID_LENGTH + 1) }],
    ['empty initial command', { initialCommand: '' }],
    ['over-limit initial command', { initialCommand: 'x'.repeat(MAX_COMMAND_LENGTH + 1) }],
  ])('rejects invalid pane fields: %s', (_label: string, paneOverride: Record<string, unknown>) => {
    // Given: a workspace with an invalid pane field.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      panes: [{ ...workspace.panes[0], ...paneOverride }],
    };

    // When / Then: the invalid snapshot is rejected.
    expectInvalidWorkspace(value);
  });

  it('rejects missing pane references', () => {
    // Given: a leaf references a pane that does not exist.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      tabs: [
        {
          ...workspace.tabs[0],
          layout: { type: 'leaf', paneId: 'missing-pane' },
          activePaneId: 'missing-pane',
        },
      ],
    };

    // When / Then: the missing reference is rejected.
    expectInvalidWorkspace(value);
  });

  it('rejects duplicate leaf references across the workspace', () => {
    // Given: two tabs reference the same pane leaf.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      tabs: [
        workspace.tabs[0],
        {
          id: 'tab-2',
          name: 'second',
          layout: { type: 'leaf', paneId: 'pane-1' },
          activePaneId: 'pane-1',
        },
      ],
    };

    // When / Then: a pane may appear in only one leaf.
    expectInvalidWorkspace(value);
  });

  it('rejects orphan panes', () => {
    // Given: the pane list contains a pane absent from every layout.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      panes: [...workspace.panes, { id: 'pane-2', cwd: '/Users/tester/project' }],
    };

    // When / Then: every pane must appear in exactly one leaf.
    expectInvalidWorkspace(value);
  });

  it.each([
    ['invalid type', { type: 'unknown' }],
    ['invalid direction', { type: 'split', direction: 'diagonal', ratio: 0.5, children: [] }],
    [
      'one child',
      {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [{ type: 'leaf', paneId: 'pane-1' }],
      },
    ],
    [
      'three children',
      {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        children: [
          { type: 'leaf', paneId: 'pane-1' },
          { type: 'leaf', paneId: 'pane-1' },
          { type: 'leaf', paneId: 'pane-1' },
        ],
      },
    ],
  ])('rejects invalid layout shapes: %s', (_label: string, layout: unknown) => {
    // Given: a workspace with an invalid layout shape.
    const workspace = createWorkspace();
    const value = {
      ...workspace,
      tabs: [{ ...workspace.tabs[0], layout }],
    };

    // When / Then: the invalid layout is rejected.
    expectInvalidWorkspace(value);
  });

  it.each([
    ['below minimum', MIN_SPLIT_RATIO - 0.01],
    ['above maximum', MAX_SPLIT_RATIO + 0.01],
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
  ])('rejects invalid split ratios: %s', (_label: string, ratio: number) => {
    // Given: a two-pane workspace with an invalid split ratio.
    const workspace = createNestedWorkspace();
    const layout = workspace.tabs[0]?.layout;
    expect(layout?.type).toBe('split');
    const value = {
      ...workspace,
      tabs: [
        {
          ...workspace.tabs[0],
          layout: { ...layout, ratio },
        },
      ],
    };

    // When / Then: the invalid ratio is rejected.
    expectInvalidWorkspace(value);
  });

  it('accepts layouts at the maximum depth', () => {
    // Given: a workspace whose deepest leaf is exactly at the allowed depth.
    const workspace = createDeepWorkspace(MAX_LAYOUT_DEPTH);

    // When / Then: the boundary-depth layout is valid.
    expect(readWorkspace(workspace, CHANNEL)).toEqual(workspace);
  });

  it('rejects layouts above the maximum depth', () => {
    // Given: a workspace whose layout exceeds the allowed depth.
    const workspace = createDeepWorkspace(MAX_LAYOUT_DEPTH + 1);

    // When / Then: excessive recursion is rejected.
    expectInvalidWorkspace(workspace);
  });
});
