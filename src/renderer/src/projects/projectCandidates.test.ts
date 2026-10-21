import { describe, expect, it } from 'vite-plus/test';
import type { Workspace } from '../../../shared/types';
import {
  createProjectCandidates,
  filterProjectCandidates,
  findProjectWorkspace,
} from './projectCandidates';

function workspace(id: string, rootPath: string, isOpen = true): Workspace {
  return {
    id,
    rootPath,
    isOpen,
    name: id,
    kind: 'project',
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('project candidates', () => {
  it('keeps registration order, adds durable projects, and excludes home', () => {
    // Given: overlapping manual and durable projects, plus home at a registered directory.
    const home = { ...workspace('home', '/home'), kind: 'home' as const };
    const projects = [home, workspace('Renamed', '/b/'), workspace('Closed', '/c', false)];

    // When: candidates are combined.
    const entries = createProjectCandidates(['/b', '/a', '/home'], projects, 'Renamed');

    // Then: one entry per path retains the saved name and state; home stays distinct.
    expect(entries).toEqual([
      { rootPath: '/b', name: 'Renamed', status: 'Active' },
      { rootPath: '/a', name: 'a', status: null },
      { rootPath: '/home', name: 'home', status: null },
      { rootPath: '/c', name: 'Closed', status: 'Closed' },
    ]);
  });

  it('prefers active open, then first open, then first closed without merging records', () => {
    // Given: multiple saved projects with equivalent roots.
    const closed = workspace('closed', '/a/b', false);
    const first = workspace('first', '/a/b/');
    const active = workspace('active', '/a/./b');
    const projects = [closed, first, active];

    // When / Then: each fallback is deterministic and returns the original object.
    expect(findProjectWorkspace(projects, '/a/b', 'active')).toBe(active);
    expect(findProjectWorkspace(projects, '/a/b', null)).toBe(first);
    expect(findProjectWorkspace([closed], '/a/b', null)).toBe(closed);
    expect(projects).toHaveLength(3);
  });

  it('labels the root directory with its path', () => {
    // Given: the root directory is registered.

    // When: candidates are created.
    const entries = createProjectCandidates(['/'], [], null);

    // Then: the root keeps a visible label instead of an empty basename.
    expect(entries[0].name).toBe('/');
  });

  it('matches name and path subsequences and ranks contiguous name matches first', () => {
    // Given: candidates with exact, prefix, substring, fuzzy, and path-only matches.
    const entries = ['a project idea', 'API', 'API server', 'my api', 'shell'].map(
      (name, index) => ({
        name,
        rootPath: index === 4 ? '/apps/api' : `/repo/${index}`,
        status: null,
      }),
    );

    // When: a case-insensitive query is ranked.
    const filtered = filterProjectCandidates(entries, ' API ');

    // Then: exact, prefix, substring, fuzzy name, and path matches are ordered predictably.
    expect(filtered.map((entry) => entry.name)).toEqual([
      'API',
      'API server',
      'my api',
      'a project idea',
      'shell',
    ]);
    expect(filterProjectCandidates(entries, 'zzz')).toEqual([]);
    expect(filterProjectCandidates(entries, ' ')).toBe(entries);
  });

  it('matches paths only as contiguous substrings', () => {
    // Given: a candidate whose path contains the query letters only as a scattered subsequence.
    const entries = [{ name: 'shell', rootPath: '/Users/tester/ghq/evermore', status: null }];

    // When / Then: a scattered path match is rejected while a contiguous segment still matches.
    expect(filterProjectCandidates(entries, 'utgv')).toEqual([]);
    expect(filterProjectCandidates(entries, 'ghq/ever')).toEqual(entries);
  });

  it('retains original order when scores tie', () => {
    // Given: matching names in registration order.
    const entries = createProjectCandidates(['/one/api', '/two/api'], [], null);
    // When / Then: score ties keep that order.
    expect(filterProjectCandidates(entries, 'api')).toEqual(entries);
  });
});
