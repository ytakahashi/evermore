import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import { findOpenWorkspace, getOpenWorkspaces } from './open-workspaces';

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
