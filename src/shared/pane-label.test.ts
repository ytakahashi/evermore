import { describe, expect, it } from 'vitest';
import type { PaneRuntimeInfo } from './types';
import { getPaneDisplayLabel } from './pane-label';

function info(overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return {
    ptyId: 'pty-1',
    processActivity: 'idle',
    foregroundSession: { kind: 'none' },
    integration: {
      shell: false,
      protocols: [],
      lastSequenceAt: 1,
      stale: false,
    },
    observedAt: 1,
    ...overrides,
  };
}

describe('getPaneDisplayLabel', () => {
  it('uses the running foreground command when available', () => {
    // Given: a running pane with a foreground command.
    const runtimeInfo = info({
      processActivity: 'running',
      foregroundCommand: 'pnpm dev',
      foregroundSession: { kind: 'other' },
    });

    // When: callers ask for the pane display label.
    const label = getPaneDisplayLabel(runtimeInfo, '/Users/tester/project');

    // Then: the live command takes precedence over cwd.
    expect(label).toBe('pnpm dev');
  });

  it('falls back to the cwd basename for idle panes', () => {
    // Given: an idle pane with a cwd.
    const runtimeInfo = info();

    // When / Then: the final cwd path segment is used.
    expect(getPaneDisplayLabel(runtimeInfo, '/Users/tester/project')).toBe('project');
  });

  it('falls back to the cwd basename when runtime info is absent', () => {
    // Given: no runtime info has been observed yet.

    // When / Then: callers still get a stable cwd label.
    expect(getPaneDisplayLabel(undefined, '/Users/tester/project')).toBe('project');
  });

  it('uses the loading fallback for blank cwd values', () => {
    // Given: the pane cwd has not been populated.

    // When / Then: the shared loading label is returned.
    expect(getPaneDisplayLabel(undefined, '')).toBe('(loading)');
  });
});
