import { describe, expect, it } from 'vitest';
import type { PaneAgentInfo } from '../types';
import {
  AGENT_DISPLAY_NAME,
  UNKNOWN_AGENT_DISPLAY_NAME,
  formatAgentDisplayName,
} from './agent-display-name';

describe('AGENT_DISPLAY_NAME', () => {
  it('exposes labels for every curated known agent', () => {
    // Given / When / Then: every curated agent has a non-empty display label.
    expect(AGENT_DISPLAY_NAME.claude).toBe('Claude Code');
    expect(AGENT_DISPLAY_NAME.codex).toBe('Codex CLI');
    expect(AGENT_DISPLAY_NAME.cursor).toBe('Cursor');
    expect(AGENT_DISPLAY_NAME.antigravity).toBe('Antigravity CLI');
  });
});

describe('formatAgentDisplayName', () => {
  it('returns the curated label for a known agent', () => {
    // Given: a pane that reports Claude Code as the agent.
    const agent: PaneAgentInfo = {
      known: 'claude',
      kind: 'claude',
      status: 'awaiting-input',
      source: 'agent-protocol',
      observedAt: 0,
    };

    // When: the formatter is asked for a display label.
    const label = formatAgentDisplayName(agent);

    // Then: the curated string for that agent is returned.
    expect(label).toBe('Claude Code');
  });

  it('falls back to the unknown agent label when no known value is present', () => {
    // Given: a pane that observed an agent but did not classify it into the curated set.
    const agent: PaneAgentInfo = {
      kind: 'mystery-bot',
      status: 'awaiting-input',
      source: 'agent-protocol',
      observedAt: 0,
    };

    // When: the formatter is asked for a display label.
    const label = formatAgentDisplayName(agent);

    // Then: the generic fallback is returned.
    expect(label).toBe(UNKNOWN_AGENT_DISPLAY_NAME);
  });

  it('falls back to the unknown agent label when agent is undefined', () => {
    // Given / When: no agent info at all.
    const label = formatAgentDisplayName(undefined);

    // Then: the generic fallback is returned.
    expect(label).toBe(UNKNOWN_AGENT_DISPLAY_NAME);
  });
});
