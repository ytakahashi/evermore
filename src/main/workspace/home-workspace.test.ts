import { describe, expect, it } from 'vite-plus/test';
import type { Workspace, WorkspaceKind } from '../../shared/types';
import { ensureSingleHomeWorkspace } from './home-workspace';

const HOME = '/Users/tester';

function createWorkspace(
  id: string,
  kind: WorkspaceKind,
  overrides: Partial<Pick<Workspace, 'isOpen' | 'rootPath'>> = {},
): Workspace {
  const rootPath = overrides.rootPath ?? `/Users/tester/${id}`;
  return {
    id,
    name: id,
    kind,
    isOpen: overrides.isOpen ?? true,
    rootPath,
    tabs: [
      {
        id: `${id}-tab`,
        name: 'zsh',
        isCustomName: false,
        layout: { type: 'leaf', paneId: `${id}-pane` },
        activePaneId: `${id}-pane`,
      },
    ],
    panes: [{ id: `${id}-pane`, cwd: rootPath }],
    activeTabId: `${id}-tab`,
    createdAt: 1,
    updatedAt: 1,
  };
}

function summarize(workspaces: Workspace[]): Array<Pick<Workspace, 'id' | 'kind' | 'isOpen'>> {
  return workspaces.map(({ id, kind, isOpen }) => ({ id, kind, isOpen }));
}

describe('ensureSingleHomeWorkspace', () => {
  it('returns the same array when exactly one valid home exists', () => {
    // Given: one open home rooted at the home directory and a closed project.
    const workspaces = [
      createWorkspace('home', 'home', { rootPath: HOME }),
      createWorkspace('project', 'project', { isOpen: false }),
    ];

    // When: the invariant is enforced.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: nothing changes, including identity.
    expect(result).toBe(workspaces);
  });

  it('promotes the first workspace when no home exists', () => {
    // Given: only projects, as after sanitizing workspaces persisted before `kind` existed.
    const workspaces = [createWorkspace('first', 'project'), createWorkspace('second', 'project')];

    // When: the invariant is enforced.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: the first becomes home rooted at the home directory and the rest stay projects.
    expect(summarize(result)).toEqual([
      { id: 'first', kind: 'home', isOpen: true },
      { id: 'second', kind: 'project', isOpen: true },
    ]);
    expect(result[0]?.rootPath).toBe(HOME);
    expect(result[1]).toBe(workspaces[1]);
  });

  it('keeps the first home and demotes later ones without reordering', () => {
    // Given: a project followed by two workspaces that both claim home.
    const workspaces = [
      createWorkspace('project', 'project'),
      createWorkspace('home-a', 'home', { rootPath: HOME }),
      createWorkspace('home-b', 'home', { rootPath: HOME }),
    ];

    // When: the invariant is enforced.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: only the first home keeps the kind and the order is unchanged.
    expect(summarize(result)).toEqual([
      { id: 'project', kind: 'project', isOpen: true },
      { id: 'home-a', kind: 'home', isOpen: true },
      { id: 'home-b', kind: 'project', isOpen: true },
    ]);
  });

  it('reopens a closed home', () => {
    // Given: a home persisted as closed.
    const workspaces = [createWorkspace('home', 'home', { isOpen: false, rootPath: HOME })];

    // When: the invariant is enforced.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: home is open again.
    expect(result[0]?.isOpen).toBe(true);
  });

  it('moves the home root path to the current home directory without touching pane cwds', () => {
    // Given: a home rooted at a previous home directory.
    const workspaces = [createWorkspace('home', 'home', { rootPath: '/Users/old-name' })];

    // When: the invariant is enforced against the current home directory.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: only the root path follows the home directory.
    expect(result[0]?.rootPath).toBe(HOME);
    expect(result[0]?.panes[0]?.cwd).toBe('/Users/old-name');
  });

  it('returns an empty list unchanged', () => {
    // Given: no workspaces.
    const workspaces: Workspace[] = [];

    // When: the invariant is enforced.
    const result = ensureSingleHomeWorkspace(workspaces, HOME);

    // Then: the caller decides how to create the first workspace.
    expect(result).toBe(workspaces);
  });
});
