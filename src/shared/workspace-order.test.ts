import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from './types';
import { moveWorkspace, type DropEdge } from './workspace-order';

function workspace(id: string, kind: 'home' | 'project' = 'project', isOpen = true): Workspace {
  return {
    id,
    name: id,
    kind,
    isOpen,
    rootPath: `/${id}`,
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('moveWorkspace', () => {
  it.each<[string, string, DropEdge, string[]]>([
    ['a', 'c', 'after', ['home', 'closed', 'b', 'c', 'a']],
    ['a', 'c', 'before', ['home', 'closed', 'b', 'a', 'c']],
    ['c', 'a', 'before', ['home', 'c', 'a', 'closed', 'b']],
    ['c', 'a', 'after', ['home', 'a', 'c', 'closed', 'b']],
    ['a', 'b', 'before', ['home', 'closed', 'a', 'b', 'c']],
  ])('moves %s %s (%s) in storage order', (source, target, edge, expected) => {
    // Given: open projects interleaved with a closed project.
    const entries = [
      workspace('home', 'home'),
      workspace('a'),
      workspace('closed', 'project', false),
      workspace('b'),
      workspace('c'),
    ];
    const original = [...entries];
    // When: a project moves relative to another project.
    const moved = moveWorkspace(entries, source, target, edge);
    // Then: only order changes; workspace contents and the input array stay untouched.
    expect(moved?.map((entry) => entry.id)).toEqual(expected);
    expect(entries).toEqual(original);
    for (const entry of moved ?? [])
      expect(entry).toBe(original.find((item) => item.id === entry.id));
  });

  it.each<[string, string, DropEdge]>([
    ['home', 'a', 'after'],
    ['a', 'home', 'before'],
    ['missing', 'a', 'before'],
    ['a', 'missing', 'after'],
    ['a', 'a', 'before'],
    ['a', 'b', 'before'],
    ['b', 'a', 'after'],
  ])('refuses or skips %s -> %s (%s)', (source, target, edge) => {
    // Given: two adjacent projects and home stored between other entries.
    const entries = [workspace('a'), workspace('b'), workspace('home', 'home')];
    // When: the request is invalid or preserves storage order.
    const moved = moveWorkspace(entries, source, target, edge);
    // Then: callers can avoid both a state write and persistence.
    expect(moved).toBeNull();
  });
});
