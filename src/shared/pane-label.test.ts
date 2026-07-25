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

  it('prefers the agent-aware label over the raw foreground command when an agent is detected', () => {
    // Given: a running pane whose foreground command is a raw agent invocation, but the tracker
    // has also identified it as a known agent with a hook-provided activity detail.
    const runtimeInfo = info({
      processActivity: 'running',
      foregroundCommand: 'claude --dangerously-skip-permissions',
      foregroundSession: { kind: 'other' },
      agent: {
        known: 'claude',
        kind: 'claude',
        status: 'running',
        source: 'agent-protocol',
        observedAt: 1,
        detail: { message: 'Edit: src/App.tsx' },
      },
    });

    // When: callers ask for the pane display label.
    const label = getPaneDisplayLabel(runtimeInfo, '/Users/tester/project');

    // Then: the agent-aware label wins, not the raw (potentially unstable) foreground command.
    expect(label).toBe('Claude Code — Edit: src/App.tsx');
  });

  it('returns the agent display name only when the agent has no detail', () => {
    // Given: a running pane detected as an agent via command-line matching (no hook configured).
    const runtimeInfo = info({
      processActivity: 'running',
      foregroundCommand: 'claude',
      foregroundSession: { kind: 'other' },
      agent: {
        known: 'claude',
        kind: 'claude',
        status: 'ready',
        source: 'command-line',
        observedAt: 1,
      },
    });

    // When / Then: the label is the agent display name, not the raw foreground command.
    expect(getPaneDisplayLabel(runtimeInfo, '/Users/tester/project')).toBe('Claude Code');
  });
});
