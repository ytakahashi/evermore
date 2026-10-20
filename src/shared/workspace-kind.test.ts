import { describe, expect, it } from 'vite-plus/test';
import type { Workspace, WorkspaceKind } from './types';
import { canDeleteWorkspace, findFallbackWorkspace } from './workspace-kind';

function createWorkspace(id: string, kind: WorkspaceKind): Workspace {
  return {
    id,
    name: id,
    kind,
    isOpen: true,
    rootPath: `/Users/tester/${id}`,
    tabs: [
      {
        id: `${id}-tab`,
        name: 'zsh',
        isCustomName: false,
        layout: { type: 'leaf', paneId: `${id}-pane` },
        activePaneId: `${id}-pane`,
      },
    ],
    panes: [{ id: `${id}-pane`, cwd: `/Users/tester/${id}` }],
    activeTabId: `${id}-tab`,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('canDeleteWorkspace', () => {
  it('allows deleting projects but not home', () => {
    // Given: a home workspace and a project workspace.
    const home = createWorkspace('home', 'home');
    const project = createWorkspace('project', 'project');

    // When / Then: only the project is deletable.
    expect(canDeleteWorkspace(home)).toBe(false);
    expect(canDeleteWorkspace(project)).toBe(true);
  });
});

describe('findFallbackWorkspace', () => {
  it('prefers home even when projects precede it', () => {
    // Given: projects are persisted before home.
    const home = createWorkspace('home', 'home');
    const workspaces = [createWorkspace('a', 'project'), createWorkspace('b', 'project'), home];

    // When / Then: home is chosen over the first workspace.
    expect(findFallbackWorkspace(workspaces)).toBe(home);
  });

  it('falls back to the first workspace when no home exists', () => {
    // Given: unnormalized data without a home workspace.
    const first = createWorkspace('a', 'project');
    const workspaces = [first, createWorkspace('b', 'project')];

    // When / Then: the first workspace is chosen.
    expect(findFallbackWorkspace(workspaces)).toBe(first);
  });

  it('returns null for an empty list', () => {
    // Given: no workspaces.

    // When / Then: there is nothing to fall back to.
    expect(findFallbackWorkspace([])).toBeNull();
  });
});
