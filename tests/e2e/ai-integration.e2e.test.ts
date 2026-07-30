// @vitest-environment node

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as nodePty from 'node-pty';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVERMORE_AGENT_STATUS_HELPER_SCRIPT } from '../../src/shared/ai-integration/snippets';
import {
  AGENT_USER_PROMPT_HOOK_MAX_CHARS,
  OSC_777_PAYLOAD_MAX_BYTES,
} from '../../src/shared/pane-integration-constants';

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
const OSC_777_PREFIX = '\x1b]777;evermore;';

describe('Evermore AI integration helper script', () => {
  let testDir: string;
  let scriptPath: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), 'evermore-ai-integration-e2e-'));
    scriptPath = join(testDir, 'evermore-agent-status.sh');
    writeFileSync(scriptPath, EVERMORE_AGENT_STATUS_HELPER_SCRIPT);
    chmodSync(scriptPath, 0o755);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('passes POSIX shell syntax validation', () => {
    // Given: the helper script has been written to a temporary file.
    // When: sh validates it without executing it.
    const result = spawnSync('sh', ['-n', scriptPath], { encoding: 'utf8' });

    // Then: the snippet is syntactically valid shell.
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it.skipIf(!hasJq)('returns an empty object for tty transport in a non-tty test process', () => {
    // Given: a hook event is piped into the helper with tty transport.
    // When: the process has no writable /dev/tty.
    const result = spawnSync(scriptPath, ['codex', 'running', 'manual', 'tty'], {
      encoding: 'utf8',
      input: '{}',
    });

    // Then: no terminalSequence response is produced and the hook exits successfully.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{}\n');
  });

  it.skipIf(!hasJq)(
    'does not wait for hook JSON when run from an interactive terminal',
    async () => {
      // Given: a pseudo-terminal invokes the helper without piping hook JSON.
      const pty = nodePty.spawn(scriptPath, ['claude', 'running'], {
        cols: 80,
        rows: 24,
        cwd: testDir,
        env: {},
      });

      // When: stdin is a TTY, the helper should treat hook input as empty instead of running cat.
      const exitCode = await waitForPtyExit(pty, 2000);

      // Then: the process exits without hanging on stdin.
      expect(exitCode).toBe(0);
    },
  );

  it.skipIf(!hasJq)('returns a terminalSequence response for Claude Code transport', () => {
    // Given: Claude Code hook stdin includes useful session metadata.
    const hookInput = JSON.stringify({
      session_id: 'session-1',
      cwd: '/tmp/project',
      tool_name: 'Edit',
    });

    // When: the helper is invoked with terminalSequence transport.
    const result = spawnSync(
      scriptPath,
      ['claude', 'running', 'user_prompt_submit', 'terminalSequence'],
      {
        encoding: 'utf8',
        input: hookInput,
      },
    );

    // Then: stdout is a Claude-compatible response carrying the Evermore OSC 777 payload.
    expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout) as { terminalSequence: string };
    expect(response.terminalSequence.startsWith('\x1b]777;evermore;')).toBe(true);
    expect(response.terminalSequence.endsWith('\x07')).toBe(true);

    const payload = JSON.parse(
      response.terminalSequence.slice('\x1b]777;evermore;'.length, -1),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      v: 1,
      type: 'agent-status',
      agent: 'claude',
      status: 'running',
      event: 'user_prompt_submit',
      sessionId: 'session-1',
      cwd: '/tmp/project',
      toolName: 'Edit',
    });
    // UserPromptSubmit never has a machine-generated activity summary yet.
    expect(payload.activityLabel).toBeUndefined();
  });

  function runHelper(
    agentArg: string,
    status: string,
    event: string,
    hookInput: Record<string, unknown>,
  ): Record<string, unknown> {
    return runHelperWithByteLength(agentArg, status, event, hookInput).payload;
  }

  /**
   * Variant of {@link runHelper} that also reports the UTF-8 size of the emitted JSON payload, so
   * byte-budget assertions measure exactly what `parseEvermoreAgentEvent()` measures.
   */
  function runHelperWithByteLength(
    agentArg: string,
    status: string,
    event: string,
    hookInput: Record<string, unknown>,
  ): { payload: Record<string, unknown>; byteLength: number } {
    const result = spawnSync(scriptPath, [agentArg, status, event, 'terminalSequence'], {
      encoding: 'utf8',
      input: JSON.stringify(hookInput),
    });
    expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout) as { terminalSequence: string };
    const payloadText = extractEvermoreAgentPayloadText(response.terminalSequence);
    return {
      payload: JSON.parse(payloadText) as Record<string, unknown>,
      byteLength: Buffer.byteLength(payloadText, 'utf8'),
    };
  }

  it.skipIf(!hasJq)('builds an activityLabel from tool_input.file_path on PostToolUse', () => {
    // Given: a PostToolUse hook reporting an Edit on a specific file.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('claude', 'running', 'post_tool_use', {
      tool_name: 'Edit',
      tool_input: { file_path: 'src/main.ts' },
    });

    // Then: activityLabel combines the tool name and the target file.
    expect(payload.activityLabel).toBe('Edit: src/main.ts');
  });

  it.skipIf(!hasJq)('builds an activityLabel from tool_input.command on PostToolUse', () => {
    // Given: a PostToolUse hook reporting a Bash tool call.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('claude', 'running', 'post_tool_use', {
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
    });

    // Then: activityLabel combines the tool name and the command.
    expect(payload.activityLabel).toBe('Bash: pnpm test');
  });

  it.skipIf(!hasJq)('builds an activityLabel from the documented Codex Bash payload', () => {
    // Given: Codex reports its canonical snake_case tool name and Bash command input.
    // When: the shared helper builds the OSC 777 payload.
    const payload = runHelper('codex', 'running', 'post_tool_use', {
      session_id: 'codex-session',
      cwd: '/tmp/project',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm run typecheck' },
    });

    // Then: the Codex metadata and command are normalized without a Claude-specific adapter.
    expect(payload).toMatchObject({
      agent: 'codex',
      sessionId: 'codex-session',
      cwd: '/tmp/project',
      toolName: 'Bash',
      activityLabel: 'Bash: pnpm run typecheck',
    });
  });

  it.skipIf(!hasJq)('extracts the target file from a Codex apply_patch command', () => {
    // Given: Codex exposes an apply_patch invocation as tool_input.command containing patch text.
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/main.ts',
      '@@',
      '-const oldValue = true;',
      '+const newValue = true;',
      '*** End Patch',
    ].join('\n');

    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('codex', 'running', 'post_tool_use', {
      tool_name: 'apply_patch',
      tool_input: { command: patch },
    });

    // Then: the Sidebar label contains the path rather than the full patch body.
    expect(payload.activityLabel).toBe('apply_patch: src/main.ts');
  });

  it.skipIf(!hasJq)('does not expose unrecognized apply_patch contents in activityLabel', () => {
    // Given: an apply_patch command without a supported Add/Update/Delete file header.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('codex', 'running', 'post_tool_use', {
      tool_name: 'apply_patch',
      tool_input: { command: 'malformed patch containing private source text' },
    });

    // Then: it safely falls back to the tool name instead of displaying the patch body.
    expect(payload.activityLabel).toBe('apply_patch');
  });

  it.skipIf(!hasJq)(
    'falls back to the tool name alone when tool_input has no recognized key',
    () => {
      // Given: a PostToolUse hook for a tool whose tool_input shape is not one of the recognized
      // keys (file_path / command / pattern).
      // When: the helper builds the OSC 777 payload.
      const payload = runHelper('claude', 'running', 'post_tool_use', {
        tool_name: 'WebFetch',
        tool_input: { url: 'https://example.com' },
      });

      // Then: activityLabel is just the tool name.
      expect(payload.activityLabel).toBe('WebFetch');
    },
  );

  it.skipIf(!hasJq)(
    'includes the target in the awaiting-input activityLabel when one is available',
    () => {
      // Given: a PermissionRequest hook for a Bash command awaiting approval.
      // When: the helper builds the OSC 777 payload.
      const payload = runHelper('codex', 'awaiting-input', 'permission_request', {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /tmp/cache' },
      });

      // Then: activityLabel names the command awaiting approval.
      expect(payload.activityLabel).toBe('Waiting for approval: rm -rf /tmp/cache');
    },
  );

  it.skipIf(!hasJq)('falls back to a generic message when awaiting-input has no target', () => {
    // Given: a PermissionRequest hook with no tool_input at all.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('claude', 'awaiting-input', 'permission_request', {});

    // Then: activityLabel is the generic waiting message.
    expect(payload.activityLabel).toBe('Waiting for approval');
  });

  it.skipIf(!hasJq)(
    'omits activityLabel on Stop while still emitting a valid status payload',
    () => {
      // Given: a Stop hook, which never carries an activity summary.
      // When: the helper builds the OSC 777 payload.
      const payload = runHelper('claude', 'complete', 'stop', {});

      // Then: the core status fields are present (regression guard for a prior jq `empty` bug that
      // dropped the entire payload instead of just the missing field) and activityLabel is absent.
      expect(payload).toMatchObject({
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'complete',
      });
      expect(payload.activityLabel).toBeUndefined();
    },
  );

  it.skipIf(!hasJq)(
    'does not crash when tool_input is null, a non-object, or missing entirely',
    () => {
      // Given / When / Then: each malformed tool_input shape still yields a valid payload that
      // falls back to the tool name (or omits activityLabel when tool_name is also absent).
      expect(
        runHelper('claude', 'running', 'post_tool_use', { tool_name: 'Edit', tool_input: null })
          .activityLabel,
      ).toBe('Edit');
      expect(
        runHelper('claude', 'running', 'post_tool_use', { tool_name: 'Edit', tool_input: 'weird' })
          .activityLabel,
      ).toBe('Edit');
      expect(runHelper('claude', 'running', 'post_tool_use', {}).activityLabel).toBeUndefined();
    },
  );

  it.skipIf(!hasJq)('accepts camelCase toolName as a compatibility fallback', () => {
    // Given: an integration sends camelCase toolName with an unrecognized tool_input shape.
    // When: the shared helper builds the OSC 777 payload.
    const payload = runHelper('codex', 'running', 'post_tool_use', {
      toolName: 'apply_patch',
      tool_input: { patch: '...' },
    });

    // Then: it falls back to the tool name without crashing.
    expect(payload.toolName).toBe('apply_patch');
    expect(payload.activityLabel).toBe('apply_patch');
  });

  it.skipIf(!hasJq)('carries the submitted prompt on the prompt-submission event', () => {
    // Given: a UserPromptSubmit hook whose stdin contains the prompt the user typed.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('claude', 'running', 'user_prompt_submit', {
      session_id: 'session-1',
      prompt: 'Fix the failing tests',
    });

    // Then: the prompt travels alongside the status fields.
    expect(payload).toMatchObject({
      agent: 'claude',
      event: 'user_prompt_submit',
      userPrompt: 'Fix the failing tests',
    });
  });

  it.skipIf(!hasJq)('accepts user_prompt and userPrompt as compatibility fallbacks', () => {
    // Given / When: agents that name the field differently submit a prompt.
    // Then: both spellings are normalized to userPrompt.
    expect(
      runHelper('codex', 'running', 'user_prompt_submit', { user_prompt: 'snake case' }).userPrompt,
    ).toBe('snake case');
    expect(
      runHelper('codex', 'running', 'user_prompt_submit', { userPrompt: 'camel case' }).userPrompt,
    ).toBe('camel case');
  });

  it.skipIf(!hasJq)('never reads a prompt from an event that does not submit one', () => {
    // Given: non-prompt events whose payloads happen to carry a prompt-shaped key. Text from these
    // is agent-authored (subagent instructions, tool arguments) and must not be shown as something
    // the user typed.
    // When: the helper builds each OSC 777 payload.
    const postToolUse = runHelper('claude', 'running', 'post_tool_use', {
      tool_name: 'Task',
      prompt: 'agent-authored subagent instruction',
    });
    const preInvocation = runHelper('antigravity', 'running', 'pre_invocation', {
      prompt: 'unconfirmed antigravity payload',
    });
    const stop = runHelper('claude', 'complete', 'stop', { prompt: 'leftover' });

    // Then: none of them contribute a userPrompt, while their status fields are unaffected.
    expect(postToolUse.userPrompt).toBeUndefined();
    expect(postToolUse.toolName).toBe('Task');
    expect(preInvocation.userPrompt).toBeUndefined();
    expect(preInvocation.status).toBe('running');
    expect(stop.userPrompt).toBeUndefined();
    expect(stop.status).toBe('complete');
  });

  it.skipIf(!hasJq)('truncates a long prompt to the hook character limit', () => {
    // Given: a prompt far longer than the hook limit.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('claude', 'running', 'user_prompt_submit', {
      prompt: 'a'.repeat(AGENT_USER_PROMPT_HOOK_MAX_CHARS + 500),
    });

    // Then: the shell cut lands on the hook limit, leaving the visible ellipsis to Evermore's own
    // display-side truncation.
    expect(payload.userPrompt).toBe('a'.repeat(AGENT_USER_PROMPT_HOOK_MAX_CHARS));
  });

  it.skipIf(!hasJq)('keeps an all-emoji prompt within the OSC 777 byte budget', () => {
    // Given: 1000 emoji, the worst realistic case at four UTF-8 bytes per code point.
    const { payload, byteLength } = runHelperWithByteLength(
      'claude',
      'running',
      'user_prompt_submit',
      { prompt: '\u{1F600}'.repeat(1000) },
    );

    // When / Then: the character limit is applied per code point, so surrogate pairs stay intact
    // and the whole payload still fits the budget.
    expect(Array.from(payload.userPrompt as string)).toHaveLength(AGENT_USER_PROMPT_HOOK_MAX_CHARS);
    expect(payload.userPrompt).not.toContain('�');
    expect(byteLength).toBeLessThan(OSC_777_PAYLOAD_MAX_BYTES);
  });

  it.skipIf(!hasJq)(
    'replaces control characters instead of letting them inflate the payload',
    () => {
      // Given: a prompt containing NUL, BEL, ESC and DEL. Escaped as \uXXXX each would cost six bytes,
      // making the payload size unpredictable from the character count.
      const nul = String.fromCharCode(0);
      const bel = String.fromCharCode(7);
      const esc = String.fromCharCode(27);
      const del = String.fromCharCode(127);

      // When: the helper builds the OSC 777 payload.
      const { payload, byteLength } = runHelperWithByteLength(
        'claude',
        'running',
        'user_prompt_submit',
        { prompt: `a${nul}b${bel}c${esc}d${del}e${del.repeat(2000)}` },
      );

      // Then: every control character became a space, and because each cost one byte rather than six
      // the payload stayed inside the budget after the ordinary character-limit cut.
      const spaceRun = ' '.repeat(AGENT_USER_PROMPT_HOOK_MAX_CHARS - 'a b c d e'.length);
      expect(payload.userPrompt).toBe(`a b c d e${spaceRun}`);
      expect(byteLength).toBeLessThan(OSC_777_PAYLOAD_MAX_BYTES);
    },
  );

  it.skipIf(!hasJq)(
    'preserves line breaks in the prompt while scrubbing other control bytes',
    () => {
      // Given: a prompt written as a list, mixing LF and CRLF endings, with stray control bytes.
      const bel = String.fromCharCode(7);
      const nul = String.fromCharCode(0);
      const tab = String.fromCharCode(9);

      // When: the helper builds the OSC 777 payload.
      const payload = runHelper('claude', 'running', 'user_prompt_submit', {
        prompt: `Fix three things:\n1. lint${bel} fights Prettier\r\n2.${nul} two${tab}tests fail`,
      });

      // Then: line structure survives — it is what makes a multi-part instruction readable — while
      // every other control character still becomes a space. CRLF arrives as one break rather than
      // two, so it does not read as a blank line downstream.
      expect(payload.userPrompt).toBe(
        'Fix three things:\n1. lint  fights Prettier\n2.  two tests fail',
      );
    },
  );

  it.skipIf(!hasJq)('keeps a newline-heavy prompt within the byte budget', () => {
    // Given: a prompt that is almost entirely line breaks, the worst case for the newline exemption.
    const { payload, byteLength } = runHelperWithByteLength(
      'claude',
      'running',
      'user_prompt_submit',
      { prompt: 'a\n'.repeat(2000) },
    );

    // When / Then: newlines are cut by the same character limit as any other content, and JSON's
    // short escape keeps each one at two bytes rather than the six an escaped control byte costs.
    expect(Array.from(payload.userPrompt as string)).toHaveLength(AGENT_USER_PROMPT_HOOK_MAX_CHARS);
    expect(byteLength).toBeLessThan(OSC_777_PAYLOAD_MAX_BYTES);
  });

  it.skipIf(!hasJq)('drops the prompt first when the payload exceeds the byte budget', () => {
    // Given: a long cwd and session id that leave no room for the prompt.
    const { payload, byteLength } = runHelperWithByteLength(
      'claude',
      'running',
      'user_prompt_submit',
      {
        session_id: 's'.repeat(1000),
        cwd: `/${'x'.repeat(6000)}`,
        prompt: '\u{1F600}'.repeat(500),
      },
    );

    // When / Then: userPrompt is the field sacrificed, and everything the status indicator needs
    // still arrives.
    expect(byteLength).toBeLessThanOrEqual(OSC_777_PAYLOAD_MAX_BYTES);
    expect(payload.userPrompt).toBeUndefined();
    expect(payload).toMatchObject({
      v: 1,
      type: 'agent-status',
      agent: 'claude',
      status: 'running',
      event: 'user_prompt_submit',
    });
    expect(payload.cwd).toBeDefined();
  });

  it.skipIf(!hasJq)(
    'degrades to the minimal payload when dropping the prompt is not enough',
    () => {
      // Given: a cwd that alone exceeds the byte budget.
      const { payload, byteLength } = runHelperWithByteLength(
        'claude',
        'running',
        'user_prompt_submit',
        { cwd: `/${'x'.repeat(9000)}`, prompt: 'short' },
      );

      // When / Then: the payload collapses to the fields the status indicator depends on.
      expect(byteLength).toBeLessThanOrEqual(OSC_777_PAYLOAD_MAX_BYTES);
      expect(payload).toEqual({
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      });
    },
  );

  it.skipIf(!hasJq)('still reports status when a huge activityLabel blows the byte budget', () => {
    // Given: a Bash call whose command is large enough that activityLabel alone exceeds the budget.
    // This shape predates prompt capture and used to make the parser discard the entire event.
    const { payload, byteLength } = runHelperWithByteLength('claude', 'running', 'post_tool_use', {
      tool_name: 'Bash',
      tool_input: { command: 'x'.repeat(9000) },
    });

    // When / Then: the status still arrives instead of the event being dropped downstream.
    expect(byteLength).toBeLessThanOrEqual(OSC_777_PAYLOAD_MAX_BYTES);
    expect(payload).toEqual({
      v: 1,
      type: 'agent-status',
      agent: 'claude',
      status: 'running',
    });
  });

  it.skipIf(!hasJq)('redacts the prompt from the debug log and creates it owner-only', () => {
    // Given: debug logging enabled with a log path that does not exist yet.
    const logPath = join(testDir, 'debug-redaction.log');
    rmSync(logPath, { force: true });
    const secret = 'do not leak this prompt body';

    // When: a prompt-submitting hook runs with debug logging on.
    const result = spawnSync(
      scriptPath,
      ['claude', 'running', 'user_prompt_submit', 'terminalSequence'],
      {
        encoding: 'utf8',
        env: { ...process.env, EVERMORE_HOOK_DEBUG: '1', EVERMORE_HOOK_LOG: logPath },
        input: JSON.stringify({ prompt: secret }),
      },
    );

    // Then: the payload still carries the prompt, but the log holds only a placeholder, and the log
    // file is readable by its owner alone rather than inheriting the /tmp default.
    expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout) as { terminalSequence: string };
    expect(parseEvermoreAgentPayload(response.terminalSequence).userPrompt).toBe(secret);
    const log = readFileSync(logPath, 'utf8');
    expect(log).not.toContain(secret);
    expect(log).toContain('"userPrompt":"[redacted]"');
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!hasJq)('writes a Codex OSC 777 payload through the tty transport', () => {
    // Given: Codex captures hook stdio, while the helper's out-of-band tty destination is injected
    // as a temporary file because test sandboxes commonly deny writes to the real /dev/tty.
    const ttyCapturePath = join(testDir, 'codex-tty-output');
    writeFileSync(ttyCapturePath, '');

    // When: the Codex hook payload is piped to the helper using tty transport.
    const result = spawnSync(scriptPath, ['codex', 'running', 'post_tool_use', 'tty'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        EVERMORE_AGENT_TTY_PATH: ttyCapturePath,
      },
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
      }),
    });

    // Then: captured stdout stays valid hook JSON and the separate tty destination receives OSC.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{}\n');
    expect(parseEvermoreAgentPayload(readFileSync(ttyCapturePath, 'utf8'))).toMatchObject({
      agent: 'codex',
      status: 'running',
      event: 'post_tool_use',
      toolName: 'Bash',
      activityLabel: 'Bash: pnpm test',
    });
  });
});

function waitForPtyExit(pty: nodePty.IPty, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pty.kill();
      reject(new Error('Timed out waiting for helper script to exit'));
    }, timeoutMs);

    pty.onExit(({ exitCode }) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
}

function parseEvermoreAgentPayload(output: string): Record<string, unknown> {
  return JSON.parse(extractEvermoreAgentPayloadText(output)) as Record<string, unknown>;
}

function extractEvermoreAgentPayloadText(output: string): string {
  const payloadStart = output.indexOf(OSC_777_PREFIX);
  if (payloadStart < 0) {
    throw new Error(`Evermore OSC 777 prefix was not found in ${JSON.stringify(output)}`);
  }
  const jsonStart = payloadStart + OSC_777_PREFIX.length;
  const payloadEnd = output.indexOf('\x07', jsonStart);
  if (payloadEnd < 0) {
    throw new Error('Evermore OSC 777 terminator was not found');
  }
  return output.slice(jsonStart, payloadEnd);
}
