import { normalizeAbsolutePath } from '../../../shared/absolute-path';
import type { AgentPreset } from '../../../shared/types';
import type { ProjectCandidate } from '../projects/projectCandidates';

export interface AgentPresetGroup {
  /** Omitted only for the shared group, which is always first and may be empty. */
  rootPath?: string;
  name: string;
  presets: AgentPreset[];
}

/** Groups for display only; persisted order remains independent of project registration order. */
export function createAgentPresetGroups(
  presets: AgentPreset[],
  candidates: ProjectCandidate[],
): AgentPresetGroup[] {
  const shared: AgentPresetGroup = { name: 'All projects', presets: [] };
  const projects = new Map<string, AgentPreset[]>();
  for (const preset of presets) {
    if (preset.rootPath === undefined) {
      shared.presets.push(preset);
    } else {
      const key = normalizeAbsolutePath(preset.rootPath);
      const entries = projects.get(key) ?? [];
      entries.push(preset);
      projects.set(key, entries);
    }
  }
  const groups = [shared];
  for (const candidate of candidates) {
    const key = normalizeAbsolutePath(candidate.rootPath);
    const entries = projects.get(key);
    if (!entries) continue;
    groups.push({ rootPath: candidate.rootPath, name: candidate.name, presets: entries });
    projects.delete(key);
  }
  for (const [rootPath, entries] of projects) {
    groups.push({ rootPath, name: rootPath, presets: entries });
  }
  return groups;
}
