import { describe, expect, it } from 'vitest';
import { formatAgentLabel } from './agent-label';
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
