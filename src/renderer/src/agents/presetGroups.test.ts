import { describe, expect, it } from 'vite-plus/test';
import type { AgentPreset } from '../../../shared/types';
import { createAgentPresetGroups } from './presetGroups';

const preset = (id: string, rootPath?: string): AgentPreset => ({
  id,
  label: id,
  command: 'codex',
  ...(rootPath ? { rootPath } : {}),
});

describe('createAgentPresetGroups', () => {
  it('orders shared, known projects and orphan scopes while retaining row order', () => {
    // Given: interleaved scopes and a candidate order different from preset order.
    const presets = [
      preset('orphan-1', '/gone/one'),
      preset('b1', '/b/'),
      preset('shared'),
      preset('a1', '/a'),
      preset('b2', '/b/./'),
      preset('orphan-2', '/gone/two'),
    ];
    const snapshot = structuredClone(presets);

    // When: display groups are created with a project that has no presets.
    const groups = createAgentPresetGroups(presets, [
      { rootPath: '/a', name: 'Renamed project', status: 'Closed' },
      { rootPath: '/unused', name: 'unused', status: null },
      { rootPath: '/b', name: 'b', status: 'Open' },
    ]);

    // Then: project order and normalized matching affect display only.
    expect(groups.map((group) => [group.name, group.presets.map((entry) => entry.id)])).toEqual([
      ['All projects', ['shared']],
      ['Renamed project', ['a1']],
      ['b', ['b1', 'b2']],
      ['/gone/one', ['orphan-1']],
      ['/gone/two', ['orphan-2']],
    ]);
    expect(presets).toEqual(snapshot);
  });

  it('retains an empty shared group for an empty list', () => {
    // Given: no presets and no projects.
    // When: groups are created.
    const groups = createAgentPresetGroups([], []);
    // Then: the shared section remains visible.
    expect(groups).toEqual([{ name: 'All projects', presets: [] }]);
  });
});
