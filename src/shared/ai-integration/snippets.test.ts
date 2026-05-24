import { describe, expect, it } from 'vitest';
import {
  ANTIGRAVITY_CLI_HOOK_SNIPPET,
  CLAUDE_CODE_HOOK_SNIPPET,
  CODEX_CLI_HOOK_SNIPPET,
  EVERMORE_AGENT_STATUS_HELPER_SCRIPT,
} from './snippets';

describe('AI integration snippets', () => {
  it('keeps the helper script aligned with the OSC 777 agent event contract', () => {
    // Given / When: the helper script text is inspected.
    // Then: it includes the protocol, jq JSON generation, and supported enum guards.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('\\033]777;evermore;%s\\a');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('jq -cn');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('claude|codex|antigravity|cursor');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('running|awaiting-input|complete');
  });

  it('defines parseable JSON hook snippets for each supported AI CLI', () => {
    // Given: the Settings copy blocks for the supported agents.
    const snippets = [
      CLAUDE_CODE_HOOK_SNIPPET,
      CODEX_CLI_HOOK_SNIPPET,
      ANTIGRAVITY_CLI_HOOK_SNIPPET,
    ];

    // When / Then: each snippet can be parsed as standalone JSON.
    for (const snippet of snippets) {
      expect(() => JSON.parse(snippet)).not.toThrow();
    }
  });

  it('uses terminalSequence only for Claude Code hooks', () => {
    // Given / When: transport strings are inspected.
    // Then: Claude uses terminalSequence while Codex and Antigravity use tty.
    expect(CLAUDE_CODE_HOOK_SNIPPET).toContain('terminalSequence');
    expect(CODEX_CLI_HOOK_SNIPPET).not.toContain('terminalSequence');
    expect(ANTIGRAVITY_CLI_HOOK_SNIPPET).not.toContain('terminalSequence');
    expect(CODEX_CLI_HOOK_SNIPPET).toContain(' codex running user_prompt_submit tty');
    expect(ANTIGRAVITY_CLI_HOOK_SNIPPET).toContain(' antigravity running pre_invocation tty');
  });

  it('omits Antigravity awaiting-input hooks until a reliable approval event exists', () => {
    // Given / When: the Antigravity snippet is inspected.
    // Then: it does not advertise a waiting state that the current CLI cannot emit reliably.
    expect(ANTIGRAVITY_CLI_HOOK_SNIPPET).not.toContain('PermissionRequest');
    expect(ANTIGRAVITY_CLI_HOOK_SNIPPET).not.toContain('awaiting-input');
  });
});
