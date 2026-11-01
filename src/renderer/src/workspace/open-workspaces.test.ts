import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import {
  findOpenWorkspace,
  resolveWorkspaceDropAnchor,
  resolveWorkspaceMoveAnchor,
  getAgentsViewWorkspaces,
  getOpenWorkspaces,
  getSidebarWorkspaces,
} from './open-workspaces';

function workspace(id: string, isOpen: boolean): Workspace {
  return {
    id,
    name: id,
    kind: 'project',
    isOpen,
    rootPath: `/${id}`,
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('open workspaces', () => {
  it('lists open workspaces in storage order', () => {
    // Given: open and closed workspaces interleaved.
    const workspaces = [workspace('a', true), workspace('b', false), workspace('c', true)];

    // When: navigation candidates are collected.
    const open = getOpenWorkspaces(workspaces);

    // Then: closed workspaces are omitted and order is preserved.
    expect(open.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('finds only open workspaces by id', () => {
    // Given: one open and one closed workspace.
    const workspaces = [workspace('open', true), workspace('closed', false)];

    // When / Then: the closed id is treated like a missing one.
    expect(findOpenWorkspace(workspaces, 'open')?.id).toBe('open');
    expect(findOpenWorkspace(workspaces, 'closed')).toBeUndefined();
    expect(findOpenWorkspace(workspaces, null)).toBeUndefined();
  });
});

it('pins home only in sidebar order without mutating storage order', () => {
  // Given: home follows a project and a closed entry.
  const home = { ...workspace('home', true), kind: 'home' as const };
  const entries = [workspace('a', true), workspace('closed', false), home, workspace('b', true)];
  // When: sidebar and structural navigation collect their entries.
  const sidebar = getSidebarWorkspaces(entries);
  // Then: only sidebar pins home; project and persisted order remain stable.
  expect(sidebar.map((entry) => entry.id)).toEqual(['home', 'a', 'b']);
  expect(getOpenWorkspaces(entries).map((entry) => entry.id)).toEqual(['a', 'home', 'b']);
  expect(entries.map((entry) => entry.id)).toEqual(['a', 'closed', 'home', 'b']);
});

it('places home last in Agents view order while keeping project order', () => {
  // Given: home stored first, between projects, and a closed entry.
  const home = { ...workspace('home', true), kind: 'home' as const };
  const entries = [home, workspace('a', true), workspace('closed', false), workspace('b', true)];
  // When: the Agents view collects its entries.
  const agentsView = getAgentsViewWorkspaces(entries);
  // Then: projects keep storage order, home follows them, and closed entries are omitted.
  expect(agentsView.map((entry) => entry.id)).toEqual(['a', 'b', 'home']);
  expect(
    getAgentsViewWorkspaces([workspace('a', true), home, workspace('b', true)]).map(
      (entry) => entry.id,
    ),
  ).toEqual(['a', 'b', 'home']);
  expect(entries.map((entry) => entry.id)).toEqual(['home', 'a', 'closed', 'b']);
});

describe('workspace move anchors', () => {
  it('resolves menu neighbors in visible project order, skipping home and closed projects', () => {
    // Given: home is stored between projects, alongside a closed project.
    const home = { ...workspace('home', true), kind: 'home' as const };
    const entries = [workspace('a', true), home, workspace('closed', false), workspace('b', true)];
    const sidebar = getSidebarWorkspaces(entries);
    // When / Then: each direction targets only the neighboring visible project.
    expect(resolveWorkspaceMoveAnchor(sidebar, 'a', 'down')).toEqual({
      targetWorkspaceId: 'b',
      edge: 'after',
    });
    expect(resolveWorkspaceMoveAnchor(sidebar, 'b', 'up')).toEqual({
      targetWorkspaceId: 'a',
      edge: 'before',
    });
    expect(resolveWorkspaceMoveAnchor(sidebar, 'a', 'up')).toBeNull();
    expect(resolveWorkspaceMoveAnchor(sidebar, 'b', 'down')).toBeNull();
    for (const id of ['home', 'closed', 'missing'])
      expect(resolveWorkspaceMoveAnchor(sidebar, id, 'up')).toBeNull();
    expect(resolveWorkspaceMoveAnchor([home, workspace('a', true)], 'a', 'up')).toBeNull();
    expect(resolveWorkspaceMoveAnchor([home, workspace('a', true)], 'a', 'down')).toBeNull();
  });

  it('resolves home drops to the first visible project regardless of storage position', () => {
    // Given: home follows a project in storage.
    const home = { ...workspace('home', true), kind: 'home' as const };
    const sidebar = getSidebarWorkspaces([workspace('a', true), home, workspace('b', true)]);
    // When / Then: home maps to the first project, projects retain their edge, and missing anchors are refused.
    for (const edge of ['before', 'after'] as const) {
      expect(resolveWorkspaceDropAnchor(sidebar, 'home', edge)).toEqual({
        targetWorkspaceId: 'a',
        edge: 'before',
      });
      expect(resolveWorkspaceDropAnchor(sidebar, 'b', edge)).toEqual({
        targetWorkspaceId: 'b',
        edge,
      });
    }
    expect(resolveWorkspaceDropAnchor([home], 'home', 'after')).toBeNull();
    expect(resolveWorkspaceDropAnchor(sidebar, 'missing', 'after')).toBeNull();
  });
});
