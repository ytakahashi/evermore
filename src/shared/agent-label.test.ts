import { describe, expect, it } from 'vitest';
import { formatAgentActivityDetail, formatAgentLabel } from './agent-label';
import type { PaneAgentInfo } from './types';

function agent(overrides: Partial<PaneAgentInfo> = {}): PaneAgentInfo {
  return {
    known: 'claude',
    kind: 'claude',
    status: 'running',
    source: 'agent-protocol',
    observedAt: 1,
    ...overrides,
  };
}

describe('formatAgentLabel', () => {
  it('uses detail.message when present', () => {
    // Given: an agent with a hook-provided message.
    const info = agent({ detail: { message: 'Approve tool use?' } });

    // When / Then: the message is appended to the display name.
    expect(formatAgentLabel(info)).toBe('Claude Code — Approve tool use?');
  });

  it('falls back to detail.activityLabel when message is absent', () => {
    // Given: an agent with only a machine-generated activity label.
    const info = agent({ detail: { activityLabel: 'Edit: src/App.tsx' } });

    // When / Then: the activity label is appended.
    expect(formatAgentLabel(info)).toBe('Claude Code — Edit: src/App.tsx');
  });

  it('falls back to detail.toolName when message and activityLabel are absent', () => {
    // Given: an agent with only a tool name.
    const info = agent({ detail: { toolName: 'Edit' } });

    // When / Then: the tool name is appended.
    expect(formatAgentLabel(info)).toBe('Claude Code — Edit');
  });

  it('falls back to detail.event when message, activityLabel, and toolName are absent', () => {
    // Given: an agent with only the raw hook event name.
    const info = agent({ detail: { event: 'post_tool_use' } });

    // When / Then: the raw event name is appended.
    expect(formatAgentLabel(info)).toBe('Claude Code — post_tool_use');
  });

  it('returns the display name only when status is ready, even if detail is present', () => {
    // Given: a ready agent that still carries detail from a prior awaiting-input/complete event.
    const info = agent({ status: 'ready', detail: { message: 'Waiting for approval' } });

    // When / Then: stale detail is not shown once the agent is idle again.
    expect(formatAgentLabel(info)).toBe('Claude Code');
  });

  it('returns the display name only when detail is absent', () => {
    // Given: an agent with no detail at all (e.g. command-line detection without hooks).
    const info = agent({ detail: undefined });

    // When / Then: the label is just the display name.
    expect(formatAgentLabel(info)).toBe('Claude Code');
  });

  it('uses the unknown-agent fallback name for agents outside the known set', () => {
    // Given: an agent kind that is not in the curated PaneKnownAgent union.
    const info = agent({
      known: undefined,
      kind: 'some-future-agent',
      detail: { toolName: 'Run' },
    });

    // When / Then: the generic AI agent label is used.
    expect(formatAgentLabel(info)).toBe('AI agent — Run');
  });
});

describe('formatAgentActivityDetail', () => {
  it('prefers message over activityLabel, toolName, and event', () => {
    // Given: an agent carrying every detail field at once.
    const info = agent({
      detail: {
        message: 'Approve tool use?',
        activityLabel: 'Edit: src/App.tsx',
        toolName: 'Edit',
        event: 'post_tool_use',
      },
    });

    // When / Then: the most specific field wins.
    expect(formatAgentActivityDetail(info)).toBe('Approve tool use?');
  });

  it('falls through activityLabel, toolName, and event as each becomes unavailable', () => {
    // Given / When / Then: each fallback step in the documented priority order.
    expect(
      formatAgentActivityDetail(
        agent({ detail: { activityLabel: 'Edit: src/App.tsx', toolName: 'Edit' } }),
      ),
    ).toBe('Edit: src/App.tsx');
    expect(
      formatAgentActivityDetail(agent({ detail: { toolName: 'Edit', event: 'post_tool_use' } })),
    ).toBe('Edit');
    expect(formatAgentActivityDetail(agent({ detail: { event: 'post_tool_use' } }))).toBe(
      'post_tool_use',
    );
  });

  it('returns undefined for a ready agent even when detail is present', () => {
    // Given: a ready agent still carrying detail from a prior awaiting-input / complete event.
    const info = agent({ status: 'ready', detail: { message: 'Waiting for approval' } });

    // When / Then: stale activity is not reported once the agent is idle again.
    expect(formatAgentActivityDetail(info)).toBeUndefined();
  });

  it('returns undefined when the agent has no detail at all', () => {
    // Given: an agent detected from the command line, with no hook detail.
    // When / Then: there is nothing to summarize.
    expect(formatAgentActivityDetail(agent({ detail: undefined }))).toBeUndefined();
  });
});
