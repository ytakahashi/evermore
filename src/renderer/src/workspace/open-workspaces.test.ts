import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import { findOpenWorkspace, getOpenWorkspaces, getSidebarWorkspaces } from './open-workspaces';

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
