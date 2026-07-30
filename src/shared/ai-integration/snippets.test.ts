import { describe, expect, it } from 'vitest';
import {
  AGENT_USER_PROMPT_HOOK_MAX_CHARS,
  OSC_777_PAYLOAD_MAX_BYTES,
} from '../pane-integration-constants';
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
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain(
      'TTY_DEVICE="${EVERMORE_AGENT_TTY_PATH:-/dev/tty}"',
    );
  });

  it('builds a Sidebar-only activityLabel field alongside the other detail fields', () => {
    // Given / When: the helper script text is inspected.
    // Then: it defines the activityLabel builder and wires it into the emitted payload. Behavioral
    // coverage (actual jq execution against fixture payloads) lives in
    // tests/e2e/ai-integration.e2e.test.ts, which spawns the real script.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('built_activity_label');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('string_field("activityLabel"');
  });

  it('extracts the submitted prompt only for the prompt-submission event', () => {
    // Given / When: the helper script text is inspected.
    // Then: the prompt builder is wired into the payload and gated on the event name, so hooks that
    // merely happen to carry a prompt-shaped key cannot contribute user-attributed text.
    // Behavioral coverage lives in tests/e2e/ai-integration.e2e.test.ts.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('submitted_prompt');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('string_field("userPrompt"');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('$event == "user_prompt_submit"');
  });

  it('keeps every hook-derived value out of the jq argument vector', () => {
    // Given / When: the helper script text is inspected.
    // Then: hook JSON and the assembled payload are piped into jq rather than passed with --arg.
    // Process arguments are readable by other users, and hook stdin can contain the user's prompt.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).not.toContain('--arg hook');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).not.toContain('--arg seq');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('printf \'%s\' "$HOOK_INPUT" | jq -Rsc');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('printf \'%s\' "$PAYLOAD" | jq -Rsc');
  });

  it('degrades an oversized payload instead of letting the parser drop the whole event', () => {
    // Given / When: the helper script text is inspected.
    // Then: it measures the assembled payload and has both degradation steps available, so a status
    // update still arrives when an optional field blows the OSC 777 byte budget.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain(
      `PAYLOAD_MAX_BYTES=${OSC_777_PAYLOAD_MAX_BYTES}`,
    );
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain(
      `PROMPT_MAX_CHARS=${AGENT_USER_PROMPT_HOOK_MAX_CHARS}`,
    );
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('build_payload false');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('build_minimal_payload');
  });

  it('redacts the prompt from debug logs and restricts the log file permissions', () => {
    // Given / When: the helper script text is inspected.
    // Then: debug logging never writes prompt text, and the log is created owner-only rather than
    // inheriting the ambient umask under /tmp.
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('.userPrompt = "[redacted]"');
    expect(EVERMORE_AGENT_STATUS_HELPER_SCRIPT).toContain('chmod 600 "$LOG"');
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
