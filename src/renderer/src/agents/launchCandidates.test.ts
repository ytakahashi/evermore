import { describe, expect, it } from 'vite-plus/test';
import { cloneDefaultSettings } from '../../../shared/settings-defaults';
import type { Workspace } from '../../../shared/types';
import {
  createLaunchTargets,
  filterLaunchPresets,
  getPresetsForTarget,
  pickDefaultPreset,
} from './launchCandidates';
import { filterProjectCandidates } from '../projects/projectCandidates';

const home: Workspace = {
  id: 'home',
  kind: 'home',
  isOpen: true,
  name: 'Default',
  rootPath: '/home',
  tabs: [],
  panes: [],
  activeTabId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('launch candidates', () => {
  it('keeps home last and distinct from a home-rooted project', () => {
    // Given: projects include the home directory and a renamed closed workspace.
    const projects: Workspace[] = [
      home,
      { ...home, id: 'project', kind: 'project', name: 'Home project' },
      {
        ...home,
        id: 'closed',
        kind: 'project',
        rootPath: '/closed',
        name: 'Archived',
        isOpen: false,
      },
    ];
    // When: candidates are built for an active home-rooted project.
    const { candidates, defaultKey } = createLaunchTargets(
      ['/home/', '/registered'],
      projects,
      'project',
    );
    // Then: registration order precedes stored-only projects; identity uses kind and normalized path.
    expect(candidates.map((candidate) => candidate.key)).toEqual([
      'project:/home',
      'project:/registered',
      'project:/closed',
      'home',
    ]);
    expect(defaultKey).toBe('project:/home');
    expect(createLaunchTargets([], projects, 'home').defaultKey).toBe('home');
    expect(filterProjectCandidates(candidates, 'Archived')[0].target).toEqual({
      kind: 'project',
      rootPath: '/closed',
    });
    expect(filterProjectCandidates(candidates, 'home')).toHaveLength(2);
  });

  it('offers scoped presets before shared ones, preserving order and searching both fields', () => {
    // Given: interleaved presets, including an unrelated project.
    const shared = cloneDefaultSettings().agents.presets;
    const scoped = {
      id: 'doc',
      label: 'With docs',
      command: 'codex --add-dir /docs',
      rootPath: '/work/./',
    };
    const presets = [shared[0], scoped, shared[1], { ...scoped, id: 'other', rootPath: '/other' }];
    // When: a normalized target is selected.
    const available = getPresetsForTarget(presets, { kind: 'project', rootPath: '/work/' });
    // Then: matching project presets come first, while home only receives shared commands.
    expect(available.map((preset) => preset.id)).toEqual(['doc', 'claude-code', 'codex']);
    expect(getPresetsForTarget(presets, { kind: 'home' })).toEqual(shared);
    expect(filterLaunchPresets(available, 'DOCS')).toEqual([scoped]);
    expect(filterLaunchPresets(available, '--add-dir')).toEqual([scoped]);
    expect(pickDefaultPreset(available, 'codex')).toBe('codex');
    expect(pickDefaultPreset(available, 'deleted')).toBe('doc');
    expect(pickDefaultPreset([], 'codex')).toBeNull();
  });
});
