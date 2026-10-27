import { normalizeAbsolutePath } from '../../../shared/absolute-path';
import type { AgentPreset, Workspace } from '../../../shared/types';
import type { LaunchTarget } from './launchTarget';
import { createProjectCandidates, type ProjectCandidate } from '../projects/projectCandidates';

export interface LaunchCandidate extends ProjectCandidate {
  key: string;
  target: LaunchTarget;
}

/** Combines project candidates with home last, selecting the active workspace by kind and path. */
export function createLaunchTargets(
  directories: string[],
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
): { candidates: LaunchCandidate[]; defaultKey: string | null } {
  const candidates: LaunchCandidate[] = createProjectCandidates(
    directories,
    workspaces,
    activeWorkspaceId,
  ).map((candidate) => ({
    ...candidate,
    key: `project:${normalizeAbsolutePath(candidate.rootPath)}`,
    target: { kind: 'project', rootPath: candidate.rootPath },
  }));
  const home = workspaces.find((workspace) => workspace.kind === 'home');
  if (home)
    candidates.push({
      key: 'home',
      target: { kind: 'home' },
      name: home.name,
      rootPath: home.rootPath,
      status: home.id === activeWorkspaceId ? 'Active' : 'Open',
    });
  const active = workspaces.find(
    (workspace) => workspace.id === activeWorkspaceId && workspace.isOpen,
  );
  const defaultKey = active
    ? active.kind === 'home'
      ? 'home'
      : `project:${normalizeAbsolutePath(active.rootPath)}`
    : (candidates[0]?.key ?? null);
  return { candidates, defaultKey };
}

/** Returns project-specific commands first, then shared commands, preserving each group's order. */
export function getPresetsForTarget(presets: AgentPreset[], target: LaunchTarget): AgentPreset[] {
  const shared = presets.filter((preset) => preset.rootPath === undefined);
  return target.kind === 'home'
    ? shared
    : [
        ...presets.filter(
          (preset) =>
            preset.rootPath !== undefined &&
            normalizeAbsolutePath(preset.rootPath) === normalizeAbsolutePath(target.rootPath),
        ),
        ...shared,
      ];
}

/** Remembers only successful launches; deleted or inapplicable presets fall back to the first. */
export function pickDefaultPreset(
  presets: AgentPreset[],
  lastPresetId: string | null,
): string | null {
  return presets.find((preset) => preset.id === lastPresetId)?.id ?? presets[0]?.id ?? null;
}

/** Searches user-facing labels and commands without changing shell syntax. */
export function filterLaunchPresets(presets: AgentPreset[], query: string): AgentPreset[] {
  const text = query.trim().toLocaleLowerCase();
  return presets.filter(
    (preset) =>
      preset.label.toLocaleLowerCase().includes(text) ||
      preset.command.toLocaleLowerCase().includes(text),
  );
}
