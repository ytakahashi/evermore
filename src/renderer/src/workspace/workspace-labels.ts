import { normalizeAbsolutePath } from '../../../shared/absolute-path';
import type { Workspace } from '../../../shared/types';

interface WorkspaceLabelEntry {
  workspace: Workspace;
  qualifiers: string[];
  depth: number;
  label: string;
}

function buildQualifiers(rootPath: string): string[] {
  const segments = normalizeAbsolutePath(rootPath).split('/').filter(Boolean);
  segments.pop();
  const qualifiers = segments.map((_, index) => segments.slice(-index - 1).join('/'));
  // The leading slash distinguishes a complete parent from a longer parent's matching suffix:
  // /foo/api and /x/foo/api must expand from "foo" to "/foo" and "x/foo", respectively.
  qualifiers.push(`/${segments.join('/')}`);
  return qualifiers;
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function countLabels(entries: readonly WorkspaceLabelEntry[]): Map<string, number> {
  return countValues(entries.map(({ label }) => label));
}

function expandCollidingLabels(entries: WorkspaceLabelEntry[]): void {
  const nameCounts = countValues(entries.map(({ workspace }) => workspace.name));
  while (true) {
    const counts = countLabels(entries);
    let advanced = false;
    for (const entry of entries) {
      // A generated qualifier must never displace an otherwise unique saved (possibly renamed) name.
      if ((nameCounts.get(entry.workspace.name) ?? 0) <= 1) continue;
      if ((counts.get(entry.label) ?? 0) <= 1 || entry.depth >= entry.qualifiers.length) continue;
      // Nonempty parent segments and the final leading slash make different qualifier depths
      // distinct for the same saved name. Only colliding entries need to advance: a deeper label
      // cannot collide with one of the same name that stopped at a shallower depth.
      entry.label = `${entry.workspace.name} — ${entry.qualifiers[entry.depth]}`;
      entry.depth += 1;
      advanced = true;
    }
    if (!advanced) break;
  }
}

function assignIdFallbacks(entries: WorkspaceLabelEntry[]): void {
  const counts = countLabels(entries);
  // Legacy records may share both a name and a root. Reserve every label before allocating ID
  // fallbacks so user-supplied names cannot collide with them; sort by ID for order independence.
  const reserved = new Set(entries.flatMap(({ workspace, label }) => [workspace.name, label]));
  for (const entry of [...entries].sort((a, b) =>
    a.workspace.id < b.workspace.id ? -1 : a.workspace.id > b.workspace.id ? 1 : 0,
  )) {
    if (entry.depth === 0 || (counts.get(entry.label) ?? 0) <= 1) continue;
    let label = `${entry.label} (${entry.workspace.id})`;
    while (reserved.has(label)) label += '#';
    reserved.add(label);
    entry.label = label;
  }
}

/**
 * Formats open workspace labels without changing durable names or depending on display order.
 * Pass the full workspace snapshot before filtering a surface's navigation candidates so every
 * surface uses the same disambiguation, even when a workspace has no agents or selectable tabs.
 */
export function formatWorkspaceLabels(
  workspaces: readonly Workspace[],
): ReadonlyMap<string, string> {
  const entries = workspaces
    .filter((workspace) => workspace.isOpen)
    .map((workspace) => ({
      workspace,
      qualifiers: buildQualifiers(workspace.rootPath),
      depth: 0,
      label: workspace.name,
    }));
  expandCollidingLabels(entries);
  assignIdFallbacks(entries);
  return new Map(entries.map(({ workspace, label }) => [workspace.id, label]));
}
