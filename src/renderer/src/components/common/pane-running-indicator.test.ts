import { describe, expect, it } from 'vitest';
import type { PaneRuntimeInfo } from '../../../../shared/types';
import { getPaneRunningIndicator } from './pane-running-indicator';

function info(overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return {
    ptyId: 'pty-1',
    processActivity: 'running',
    foregroundSession: { kind: 'other' },
    integration: {
      shell: false,
      protocols: [],
      lastSequenceAt: 0,
      stale: false,
    },
    observedAt: 1000,
    ...overrides,
  };
}

describe('getPaneRunningIndicator', () => {
  it('returns undefined for missing or idle info so the dot is not rendered', () => {
    // Given / When / Then: no dot when there's nothing running.
    expect(getPaneRunningIndicator(undefined)).toBeUndefined();
    expect(
      getPaneRunningIndicator(
        info({ processActivity: 'idle', foregroundSession: { kind: 'none' } }),
      ),
    ).toBeUndefined();
  });

  it('returns the running dot for non-agent foreground processes', () => {
    // Given: a generic foreground process with no agent slot.
    // When / Then: the green running dot is selected.
    const indicator = getPaneRunningIndicator(info());
    expect(indicator?.className).toContain('bg-success');
    expect(indicator?.label).toBe('running');
  });

  it('returns the running dot when the agent is in the ready state', () => {
    // Given: a known agent sitting at its input prompt.
    // When / Then: the indicator still shows the running dot so ready maps to the same affordance
    // as a non-agent running process.
    const indicator = getPaneRunningIndicator(
      info({
        agent: {
          known: 'claude',
          kind: 'claude',
          status: 'ready',
          source: 'command-line',
          observedAt: 1000,
        },
      }),
    );
    expect(indicator?.className).toContain('bg-success');
    expect(indicator?.label).toBe('running');
  });

  it('returns the working dot when the agent is in the running state', () => {
    // Given: an agent actively processing a turn.
    // When / Then: the blue pulse dot is selected.
    const indicator = getPaneRunningIndicator(
      info({
        agent: {
          known: 'claude',
          kind: 'claude',
          status: 'running',
          source: 'agent-protocol',
          observedAt: 1000,
        },
      }),
    );
    expect(indicator?.className).toContain('bg-accent');
    expect(indicator?.className).toContain('animate-pulse');
    expect(indicator?.label).toBe('working');
  });

  it('returns the awaiting-input dot when the agent status asks for user input', () => {
    // Given: an agent asking for approval through its own status field.
    // When / Then: the red dot is selected and takes precedence over `running`.
    const indicator = getPaneRunningIndicator(
      info({
        agent: {
          known: 'claude',
          kind: 'claude',
          status: 'awaiting-input',
          source: 'agent-protocol',
          observedAt: 1000,
        },
      }),
    );
    expect(indicator?.className).toContain('bg-danger');
    expect(indicator?.className).toContain('animate-ping');
    expect(indicator?.label).toBe('awaiting input');
  });

  it('returns the awaiting-input dot when attention is set even if the agent slot is empty', () => {
    // Given: a runtime info with attention set independently of `agent`. Future surfaces (for
    // example a non-agent notification source) may set attention without populating agent.
    // When / Then: the red dot is selected.
    const indicator = getPaneRunningIndicator(
      info({
        attention: {
          kind: 'awaiting-input',
          source: 'agent-protocol',
          observedAt: 1000,
        },
      }),
    );
    expect(indicator?.className).toContain('bg-danger');
    expect(indicator?.className).toContain('animate-ping');
    expect(indicator?.label).toBe('awaiting input');
  });
});
