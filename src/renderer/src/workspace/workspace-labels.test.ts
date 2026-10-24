import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import { formatWorkspaceLabels } from './workspace-labels';

function workspace(id: string, rootPath: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    rootPath,
    name: 'api',
    kind: 'project',
    isOpen: true,
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('formatWorkspaceLabels', () => {
  it('preserves unique saved names, including renamed names and case differences', () => {
    // Given: distinct names, one of which differs from its directory basename.
    const entries = [
      workspace('a', '/foo/api'),
      workspace('b', '/bar/api', { name: 'Backend' }),
      workspace('c', '/baz/api', { name: 'API' }),
    ];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: the saved names are used verbatim.
    expect([...labels.values()]).toEqual(['api', 'Backend', 'API']);
  });

  it('adds parent directories only to colliding names, including custom names', () => {
    // Given: renamed workspaces share a name unrelated to their root basename.
    const entries = [
      workspace('a', '/foo/server', { name: 'Backend' }),
      workspace('b', '/bar/server', { name: 'Backend' }),
    ];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: the custom name remains primary.
    expect([...labels.values()]).toEqual(['Backend — foo', 'Backend — bar']);
  });

  it('extends shared parents until the directories are distinguishable', () => {
    // Given: two roots share their immediate parent, while a third differs immediately.
    const entries = [
      workspace('a', '/team-a/foo/api'),
      workspace('b', '/team-b/foo/api'),
      workspace('c', '/bar/api'),
    ];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: only the still-ambiguous labels need another path component.
    expect([...labels.values()]).toEqual(['api — team-a/foo', 'api — team-b/foo', 'api — bar']);
  });

  it('distinguishes a complete parent from the matching suffix of a longer parent', () => {
    // Given: one parent is a suffix of another, and a third shares that longer suffix.
    const entries = [
      workspace('short', '/foo/api'),
      workspace('medium', '/x/foo/api'),
      workspace('long', '/y/x/foo/api'),
    ];

    // When: collisions expand through different qualifier depths, in either input order.
    const labels = formatWorkspaceLabels(entries);
    const reversed = formatWorkspaceLabels([...entries].reverse());

    // Then: shorter parents stop at their absolute form without needing ID fallbacks.
    expect(labels.get('short')).toBe('api — /foo');
    expect(labels.get('medium')).toBe('api — /x/foo');
    expect(labels.get('long')).toBe('api — y/x/foo');
    for (const { id } of entries) expect(reversed.get(id)).toBe(labels.get(id));
  });

  it('recomputes labels after close, reopen, and rename without mutating input', () => {
    // Given: two colliding names in an immutable snapshot.
    const a = Object.freeze(workspace('a', '/foo/api'));
    const b = Object.freeze(workspace('b', '/bar/api'));
    const entries = Object.freeze([a, b]);
    // When: a peer closes, reopens, and is renamed.
    const before = formatWorkspaceLabels(entries);
    const closed = formatWorkspaceLabels([a, { ...b, isOpen: false }]);
    const reopened = formatWorkspaceLabels(entries);
    const renamed = formatWorkspaceLabels([a, { ...b, name: 'Backend' }]);
    // Then: closed records have no label and the durable name stays unchanged.
    expect(before.get('a')).toBe('api — foo');
    expect([...closed]).toEqual([['a', 'api']]);
    expect(reopened).toEqual(before);
    expect([...renamed.values()]).toEqual(['api', 'Backend']);
    expect(a.name).toBe('api');
    expect(b.name).toBe('api');
  });

  it('includes home even when a project is rooted at the same directory', () => {
    // Given: home and a project have identical names and roots.
    const entries = [
      workspace('home', '/Users/tester', { kind: 'home' }),
      workspace('project', '/Users/tester'),
    ];
    // When: labels are formatted in either order.
    const labels = formatWorkspaceLabels(entries);
    const reversed = formatWorkspaceLabels([...entries].reverse());
    // Then: stable IDs disambiguate legacy duplicates independently of array order.
    expect(labels.get('home')).toBe('api — /Users (home)');
    expect(labels.get('project')).toBe('api — /Users (project)');
    expect(reversed.get('home')).toBe(labels.get('home'));
    expect(reversed.get('project')).toBe(labels.get('project'));
  });

  it('handles root directories and normalizes separators and dot segments lexically', () => {
    // Given: roots with redundant segments and a project at filesystem root.
    const entries = [
      workspace('a', '/foo/./x/../api///'),
      workspace('b', '/bar//api/'),
      workspace('root', '/'),
    ];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: parent labels are meaningful, including at root.
    expect([...labels.values()]).toEqual(['api — foo', 'api — bar', 'api — /']);
  });

  it('preserves unique saved names that look like generated qualifiers', () => {
    // Given: a unique custom name would collide with a generated label.
    const entries = [
      workspace('a', '/team/foo/api'),
      workspace('b', '/bar/api'),
      workspace('custom', '/elsewhere', { name: 'api — foo' }),
    ];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: only the generated label expands further.
    expect([...labels.values()]).toEqual(['api — team/foo', 'api — bar', 'api — foo']);
  });

  it('reserves saved names when allocating ID fallbacks', () => {
    // Given: duplicate roots and a user name resembling their ID fallback.
    const entries = [
      workspace('a', '/foo/api'),
      workspace('b', '/foo/api'),
      workspace('custom', '/elsewhere', { name: 'api — /foo (a)' }),
    ];
    // When: labels are formatted in either order.
    const labels = formatWorkspaceLabels(entries);
    const reversed = formatWorkspaceLabels([...entries].reverse());
    // Then: every label is unique and saved names remain intact.
    expect(labels.get('a')).toBe('api — /foo (a)#');
    expect(labels.get('custom')).toBe('api — /foo (a)');
    expect(new Set(labels.values()).size).toBe(entries.length);
    for (const { id } of entries) expect(reversed.get(id)).toBe(labels.get(id));
  });

  it('returns no labels when every workspace is closed', () => {
    // Given: no open workspace is available.
    const entries = [workspace('a', '/foo/api', { isOpen: false })];
    // When: labels are formatted.
    const labels = formatWorkspaceLabels(entries);
    // Then: no closed record contributes a label.
    expect(labels.size).toBe(0);
  });
});
