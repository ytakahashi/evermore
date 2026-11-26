// @vitest-environment node

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as nodePty from 'node-pty';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { EVERMORE_AGENT_STATUS_HELPER_SCRIPT } from '../../src/shared/ai-integration/snippets';
import {
  AGENT_SESSION_TITLE_HOOK_MAX_CHARS,
  AGENT_USER_PROMPT_HOOK_MAX_CHARS,
  OSC_777_PAYLOAD_MAX_BYTES,
} from '../../src/shared/pane-integration-constants';
import { resolveHostDependency } from './host-dependency';

const hasJq = resolveHostDependency(
  'jq',
  spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0,
);
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
    // Given: Claude Code hook stdin includes useful session metadata and its transcript path.
    const transcriptPath = writeTranscript('claude-transport', [aiTitleLine('Transport title')]);
    const hookInput = JSON.stringify({
      session_id: 'session-1',
      transcript_path: transcriptPath,
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
      sessionTitle: 'Transport title',
    });
    // UserPromptSubmit never has a machine-generated activity summary yet.
    expect(payload.activityLabel).toBeUndefined();
  });

  function runHelper(
    agentArg: string,
    status: string,
    event: string,
    hookInput: Record<string, unknown> | string,
    env?: NodeJS.ProcessEnv,
  ): Record<string, unknown> {
    return runHelperWithByteLength(agentArg, status, event, hookInput, env).payload;
  }

  /**
   * Variant of {@link runHelper} that also reports the UTF-8 size of the emitted JSON payload, so
   * byte-budget assertions measure exactly what `parseEvermoreAgentEvent()` measures.
   */
  function runHelperWithByteLength(
    agentArg: string,
    status: string,
    event: string,
    hookInput: Record<string, unknown> | string,
    env?: NodeJS.ProcessEnv,
  ): { payload: Record<string, unknown>; byteLength: number } {
    const result = spawnSync(scriptPath, [agentArg, status, event, 'terminalSequence'], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: join(testDir, 'missing-codex-home'), ...env },
      input: typeof hookInput === 'string' ? hookInput : JSON.stringify(hookInput),
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

  it.skipIf(!hasJq)('builds toolName and activityLabel from Antigravity toolCall payloads', () => {
    // Given: Antigravity PostToolUse payloads carrying nested toolCall.name and toolCall.args.
    // When: the shared helper builds the OSC 777 payloads for command and file tools.
    const commandPayload = runHelper('antigravity', 'running', 'post_tool_use', {
      conversationId: 'agy-conv-1',
      workspacePaths: ['/tmp/agy-project'],
      toolCall: {
        name: 'run_command',
        args: { CommandLine: 'pnpm test' },
      },
    });
    const filePayload = runHelper('antigravity', 'running', 'post_tool_use', {
      toolCall: {
        name: 'edit_file',
        args: { Path: 'src/main/index.ts' },
      },
    });
    const malformedToolCall = runHelper('antigravity', 'running', 'post_tool_use', {
      toolCall: 'not-an-object',
    });

    // Then: Antigravity tool names and targets are normalized into toolName and activityLabel.
    expect(commandPayload).toMatchObject({
      agent: 'antigravity',
      sessionId: 'agy-conv-1',
      cwd: '/tmp/agy-project',
      toolName: 'run_command',
      activityLabel: 'run_command: pnpm test',
    });
    expect(filePayload).toMatchObject({
      agent: 'antigravity',
      toolName: 'edit_file',
      activityLabel: 'edit_file: src/main/index.ts',
    });
    expect(malformedToolCall.toolName).toBeUndefined();
    expect(malformedToolCall.activityLabel).toBeUndefined();
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

  it.skipIf(!hasJq)('carries lastUserInput on Antigravity PreInvocation events', () => {
    // Given: an Antigravity PreInvocation hook carrying the common lastUserInput field.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('antigravity', 'running', 'pre_invocation', {
      conversationId: 'agy-conv-1',
      workspacePaths: ['/tmp/agy-project'],
      lastUserInput: 'Fix the failing unit test',
    });

    // Then: lastUserInput is normalized to userPrompt for the turn start.
    expect(payload).toMatchObject({
      agent: 'antigravity',
      event: 'pre_invocation',
      sessionId: 'agy-conv-1',
      cwd: '/tmp/agy-project',
      userPrompt: 'Fix the failing unit test',
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

  it.skipIf(!hasJq)('does not treat lastUserInput as a prompt on user_prompt_submit', () => {
    // Given: a prompt-submission payload carrying only Antigravity's lastUserInput field.
    // When: the helper builds the OSC 777 payload.
    const payload = runHelper('codex', 'running', 'user_prompt_submit', {
      lastUserInput: 'antigravity-only field',
    });

    // Then: lastUserInput is reserved for pre_invocation and contributes no userPrompt here.
    expect(payload.userPrompt).toBeUndefined();
  });

  it.skipIf(!hasJq)('never reads a prompt from an event that does not submit one', () => {
    // Given: non-prompt events whose payloads happen to carry a prompt-shaped key, or a
    // PreInvocation carrying a generic prompt key rather than Antigravity's lastUserInput. Text
    // from these is agent-authored or ambient metadata and must not be shown as something the user
    // typed on that event.
    // When: the helper builds each OSC 777 payload.
    const postToolUse = runHelper('claude', 'running', 'post_tool_use', {
      tool_name: 'Task',
      prompt: 'agent-authored subagent instruction',
    });
    const agyPostToolUse = runHelper('antigravity', 'running', 'post_tool_use', {
      lastUserInput: 'Fix the failing unit test',
      toolCall: { name: 'run_command', args: { CommandLine: 'pnpm test' } },
    });
    const preInvocation = runHelper('antigravity', 'running', 'pre_invocation', {
      prompt: 'unconfirmed antigravity payload',
    });
    const stop = runHelper('claude', 'complete', 'stop', {
      prompt: 'leftover',
      lastUserInput: 'leftover',
    });

    // Then: none of them contribute a userPrompt, while their status fields are unaffected.
    expect(postToolUse.userPrompt).toBeUndefined();
    expect(postToolUse.toolName).toBe('Task');
    expect(agyPostToolUse.userPrompt).toBeUndefined();
    expect(agyPostToolUse.activityLabel).toBe('run_command: pnpm test');
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

  it.skipIf(!hasJq)('replaces C1 control characters so the OSC sequence is not cut short', () => {
    // Given: a prompt containing C1 controls, including U+009C (ST), which xterm treats as an OSC
    // terminator. jq does not escape this range, so it would reach the terminal as-is.
    const pad = String.fromCharCode(0x80);
    const csi = String.fromCharCode(0x9b);
    const st = String.fromCharCode(0x9c);
    const apc = String.fromCharCode(0x9f);

    // When: the helper builds the terminalSequence response.
    const result = spawnSync(
      scriptPath,
      ['claude', 'running', 'user_prompt_submit', 'terminalSequence'],
      {
        encoding: 'utf8',
        input: JSON.stringify({ prompt: `a${pad}b${csi}c${st}d${apc}e` }),
      },
    );

    // Then: each C1 control became a space, and the emitted sequence carries none of them, so ST
    // never appears before the closing BEL.
    expect(result.status).toBe(0);
    const response = JSON.parse(result.stdout) as { terminalSequence: string };
    expect(parseEvermoreAgentPayload(response.terminalSequence).userPrompt).toBe('a b c d e');
    expect(response.terminalSequence).not.toMatch(/[\u0080-\u009f]/);
  });

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

  /**
   * Writes a Claude Code transcript fixture made of the given JSONL lines and returns its path.
   * Lines are passed through verbatim so tests can include deliberately malformed entries.
   */
  function writeTranscript(name: string, lines: readonly string[]): string {
    const transcriptPath = join(testDir, `${name}.jsonl`);
    writeFileSync(transcriptPath, lines.map((line) => `${line}\n`).join(''));
    return transcriptPath;
  }

  function aiTitleLine(title: string): string {
    return JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: 'session-1' });
  }

  it.skipIf(!hasJq)('sends the last ai-title from the Claude Code transcript', () => {
    // Given: a transcript where the title was regenerated, with ordinary entries in between.
    const transcriptPath = writeTranscript('claude-multiple-titles', [
      aiTitleLine('Initial title'),
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      aiTitleLine('Refined title'),
      JSON.stringify({ type: 'assistant', message: { content: 'done' } }),
    ]);

    // When: any Claude Code hook runs with that transcript_path.
    const payload = runHelper('claude', 'complete', 'stop', {
      session_id: 'session-1',
      transcript_path: transcriptPath,
    });

    // Then: the most recent title is the one that is sent.
    expect(payload).toMatchObject({
      agent: 'claude',
      status: 'complete',
      sessionId: 'session-1',
      sessionTitle: 'Refined title',
    });
  });

  it.skipIf(!hasJq)(
    'falls back to the previous title when the last ai-title line is broken',
    () => {
      // Given: a transcript whose later ai-title candidates are truncated, have a non-string
      // title, or contain a NUL byte that would make grep treat the file as binary.
      const nul = String.fromCharCode(0);
      const transcriptPath = writeTranscript('claude-broken-last-title', [
        aiTitleLine('Valid title'),
        JSON.stringify({ type: 'ai-title', aiTitle: 42 }),
        JSON.stringify({ type: 'ai-title', aiTitle: '' }),
        `{"type":"ai-title","aiTitle":"Corrupt${nul}`,
        '{"type":"ai-title","aiTitle":"Trunc',
      ]);

      // When: the helper builds the payload.
      const payload = runHelper('claude', 'running', 'post_tool_use', {
        transcript_path: transcriptPath,
        tool_name: 'Edit',
      });

      // Then: the last valid title is used rather than dropping the field.
      expect(payload.sessionTitle).toBe('Valid title');
      expect(payload.toolName).toBe('Edit');
    },
  );

  it.skipIf(!hasJq)('ignores escaped ai-title text inside other transcript entries', () => {
    // Given: a prompt that mentions the ai-title marker. JSON-escaping keeps it from matching the
    // literal marker, so this entry must not be mistaken for a title.
    const transcriptPath = writeTranscript('claude-escaped-marker', [
      aiTitleLine('Real title'),
      JSON.stringify({
        type: 'user',
        message: { content: '{"type":"ai-title","aiTitle":"Fake"}' },
      }),
    ]);

    // When: the helper builds the payload.
    const payload = runHelper('claude', 'complete', 'stop', { transcript_path: transcriptPath });

    // Then: only the real ai-title line contributes.
    expect(payload.sessionTitle).toBe('Real title');
  });

  it.skipIf(!hasJq)(
    'omits sessionTitle but still reports status when no title is available',
    () => {
      // Given: a missing transcript, a transcript without ai-title, one whose candidates are all
      // broken, a directory in place of a file, and a non-string transcript_path.
      const noTitlePath = writeTranscript('claude-no-title', [
        JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      ]);
      const allBrokenPath = writeTranscript('claude-all-broken', [
        '{"type":"ai-title","aiTitle":',
        JSON.stringify({ type: 'ai-title' }),
      ]);
      const inputs: Record<string, unknown>[] = [
        { transcript_path: join(testDir, 'does-not-exist.jsonl') },
        { transcript_path: noTitlePath },
        { transcript_path: allBrokenPath },
        { transcript_path: testDir },
        { transcript_path: 42 },
        {},
      ];

      for (const input of inputs) {
        // When: the helper builds the payload.
        const payload = runHelper('claude', 'complete', 'stop', {
          session_id: 'session-1',
          ...input,
        });

        // Then: the title is omitted and the status fields still arrive.
        expect(payload.sessionTitle).toBeUndefined();
        expect(payload).toMatchObject({
          agent: 'claude',
          status: 'complete',
          event: 'stop',
          sessionId: 'session-1',
        });
      }
    },
  );

  it.skipIf(!hasJq)('collapses the title onto one line and bounds its length', () => {
    // Given: titles containing LF, CRLF, a tab, DEL and the C1 control U+009C (ST, which xterm
    // treats as an OSC terminator), and one far beyond the hook limit.
    const tab = String.fromCharCode(9);
    const del = String.fromCharCode(127);
    const st = String.fromCharCode(0x9c);
    const multilinePath = writeTranscript('claude-multiline-title', [
      aiTitleLine(`Fix lint\nand${tab}tests\r\nnow${del}!${st}done`),
    ]);
    const longPath = writeTranscript('claude-long-title', [
      aiTitleLine('\u{1F600}'.repeat(AGENT_SESSION_TITLE_HOOK_MAX_CHARS + 100)),
    ]);

    // When: the helper builds each payload.
    const multiline = runHelper('claude', 'complete', 'stop', { transcript_path: multilinePath });
    const long = runHelper('claude', 'complete', 'stop', { transcript_path: longPath });

    // Then: LF and other C0/C1 control characters become spaces and CR is dropped, and the long
    // title is cut per code point at the hook limit so Evermore can add the visible ellipsis
    // itself.
    expect(multiline.sessionTitle).toBe('Fix lint and tests now ! done');
    expect(Array.from(long.sessionTitle as string)).toHaveLength(
      AGENT_SESSION_TITLE_HOOK_MAX_CHARS,
    );
    expect(long.sessionTitle).not.toContain('�');
  });

  it.skipIf(!hasJq)('reads the transcript from pretty-printed hook JSON', () => {
    // Given: hook stdin spread over several lines, which must not be confused with the title line
    // that shares stdin with it inside the helper.
    const transcriptPath = writeTranscript('claude-pretty-input', [aiTitleLine('Pretty title')]);
    const hookInput = JSON.stringify(
      { session_id: 'session-1', transcript_path: transcriptPath, prompt: 'line one\nline two' },
      null,
      2,
    );

    // When: the helper builds the payload.
    const payload = runHelper('claude', 'running', 'user_prompt_submit', hookInput);

    // Then: both the hook fields and the title are intact.
    expect(payload).toMatchObject({
      sessionId: 'session-1',
      sessionTitle: 'Pretty title',
      userPrompt: 'line one\nline two',
    });
  });

  it.skipIf(!hasJq)('keeps the title when the prompt is dropped for the byte budget', () => {
    // Given: a long cwd and session id that leave room for the title but not the prompt.
    const transcriptPath = writeTranscript('claude-budget-title', [aiTitleLine('Budget title')]);
    const sessionId = 's'.repeat(1000);

    // When: the helper builds the payload.
    const { payload, byteLength } = runHelperWithByteLength(
      'claude',
      'running',
      'user_prompt_submit',
      {
        session_id: sessionId,
        transcript_path: transcriptPath,
        cwd: `/${'x'.repeat(6000)}`,
        prompt: '\u{1F600}'.repeat(500),
      },
    );

    // Then: the prompt is the first field sacrificed while the title survives.
    expect(byteLength).toBeLessThanOrEqual(OSC_777_PAYLOAD_MAX_BYTES);
    expect(payload.userPrompt).toBeUndefined();
    expect(payload).toMatchObject({ sessionId, sessionTitle: 'Budget title' });
  });

  it.skipIf(!hasJq)('drops the title together with everything else in the minimal payload', () => {
    // Given: a cwd that alone exceeds the byte budget, alongside a readable title.
    const transcriptPath = writeTranscript('claude-minimal-title', [aiTitleLine('Lost title')]);

    // When: the helper builds the payload.
    const payload = runHelper('claude', 'running', 'user_prompt_submit', {
      transcript_path: transcriptPath,
      cwd: `/${'x'.repeat(9000)}`,
      prompt: 'short',
    });

    // Then: the payload collapses to the bare status fields.
    expect(payload).toEqual({ v: 1, type: 'agent-status', agent: 'claude', status: 'running' });
  });

  it.skipIf(!hasJq)(
    'redacts the prompt and title from the debug log and creates it owner-only',
    () => {
      // Given: debug logging enabled with a log path that does not exist yet, and a transcript whose
      // title could reveal what the session is about.
      const logPath = join(testDir, 'debug-redaction.log');
      rmSync(logPath, { force: true });
      const secret = 'do not leak this prompt body';
      const secretTitle = 'do not leak this session title';
      const transcriptPath = writeTranscript('claude-debug-title', [aiTitleLine(secretTitle)]);

      // When: a prompt-submitting hook runs with debug logging on.
      const result = spawnSync(
        scriptPath,
        ['claude', 'running', 'user_prompt_submit', 'terminalSequence'],
        {
          encoding: 'utf8',
          env: { ...process.env, EVERMORE_HOOK_DEBUG: '1', EVERMORE_HOOK_LOG: logPath },
          input: JSON.stringify({ prompt: secret, transcript_path: transcriptPath }),
        },
      );

      // Then: the payload still carries the prompt and title, but the log holds only placeholders,
      // and the log file is readable by its owner alone rather than inheriting the /tmp default.
      expect(result.status).toBe(0);
      const response = JSON.parse(result.stdout) as { terminalSequence: string };
      expect(parseEvermoreAgentPayload(response.terminalSequence)).toMatchObject({
        userPrompt: secret,
        sessionTitle: secretTitle,
      });
      const log = readFileSync(logPath, 'utf8');
      expect(log).not.toContain(secret);
      expect(log).not.toContain(secretTitle);
      expect(log).toContain('"userPrompt":"[redacted]"');
      expect(log).toContain('"sessionTitle":"[redacted]"');
      expect(statSync(logPath).mode & 0o777).toBe(0o600);
    },
  );

  function writeCodexIndex(codexHome: string, lines: readonly string[]): void {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'session_index.jsonl'), `${lines.join('\n')}\n`);
  }

  function codexTitleLine(id: string, title: string): string {
    return JSON.stringify({ id, thread_name: title });
  }

  it.skipIf(!hasJq)('writes the latest matching Codex title through the tty transport', () => {
    // Given: Codex captures hook stdio, while the helper's out-of-band tty destination is injected
    // as a temporary file because test sandboxes commonly deny writes to the real /dev/tty.
    const ttyCapturePath = join(testDir, 'codex-tty-output');
    writeFileSync(ttyCapturePath, '');
    const codexHome = join(testDir, 'custom codex home');
    const home = join(testDir, 'codex-tty-home');
    const sessionId = 'codex-session';
    writeCodexIndex(join(home, '.codex'), [codexTitleLine(sessionId, 'Default title')]);
    writeCodexIndex(codexHome, [
      codexTitleLine(sessionId, 'Provisional title'),
      codexTitleLine(sessionId, 'Updated title'),
      codexTitleLine(`${sessionId}-other`, 'Different session'),
      JSON.stringify({ id: sessionId, thread_name: 42 }),
      codexTitleLine(sessionId, ''),
      'null',
      '{"id":"codex-session","thread_name":"Trunc',
    ]);

    // When: the Codex hook payload is piped to the helper using tty transport.
    const result = spawnSync(scriptPath, ['codex', 'running', 'post_tool_use', 'tty'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: codexHome,
        EVERMORE_AGENT_TTY_PATH: ttyCapturePath,
      },
      input: JSON.stringify(
        { session_id: sessionId, tool_name: 'Bash', tool_input: { command: 'pnpm test' } },
        null,
        2,
      ),
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
      sessionId,
      sessionTitle: 'Updated title',
    });
  });

  it.skipIf(!hasJq)('uses the default Codex home when CODEX_HOME is unset or empty', () => {
    // Given: a default index with a title containing line breaks and an OSC terminator.
    const home = join(testDir, 'codex-default-home');
    const st = String.fromCharCode(0x9c);
    writeCodexIndex(join(home, '.codex'), [
      codexTitleLine('session-1', `Title\r\nwith${st}breaks`),
    ]);

    // When / Then: either form of an absent override uses the default index and normalizes its title.
    for (const codexHome of [undefined, '']) {
      const payload = runHelper(
        'codex',
        'complete',
        'stop',
        { session_id: 'session-1' },
        {
          HOME: home,
          CODEX_HOME: codexHome,
        },
      );
      expect(payload.sessionTitle).toBe('Title with breaks');
    }
  });

  it.skipIf(!hasJq)('reports Codex status when no title can be looked up', () => {
    // Given: an index with one named session, entries without valid names, and an unusable index.
    const codexHome = join(testDir, 'codex-no-title');
    writeCodexIndex(codexHome, [
      codexTitleLine('session-1', 'Known title'),
      codexTitleLine('empty-title', ''),
      JSON.stringify({ id: 'invalid-title', thread_name: 42 }),
    ]);
    const directoryIndex = join(testDir, 'codex-directory-index');
    mkdirSync(join(directoryIndex, 'session_index.jsonl'), { recursive: true });

    // When / Then: missing or invalid IDs and missing or unusable indexes only omit the title.
    for (const [home, input] of [
      [codexHome, {}],
      [codexHome, { session_id: '' }],
      [codexHome, { session_id: 42 }],
      [codexHome, { sessionId: 'session-1' }],
      [codexHome, { session_id: 'session' }],
      [codexHome, { session_id: 'empty-title' }],
      [codexHome, { session_id: 'invalid-title' }],
      [codexHome, '{"session_id":"session-1"'],
      [directoryIndex, { session_id: 'session-1' }],
      [join(testDir, 'missing-codex-home'), { session_id: 'session-1' }],
    ] as const) {
      const payload = runHelper('codex', 'complete', 'stop', input, { CODEX_HOME: home });
      expect(payload).toMatchObject({ agent: 'codex', status: 'complete', event: 'stop' });
      expect(payload.sessionTitle).toBeUndefined();
    }
  });

  it.skipIf(!hasJq)('uses only the title source for the active agent', () => {
    // Given: the hook references a Claude transcript and an ID with a different Codex title.
    const sessionId = 'session-1';
    const transcriptPath = writeTranscript('claude-other-agents', [aiTitleLine('Claude only')]);
    const codexHome = join(testDir, 'codex-other-agents');
    writeCodexIndex(codexHome, [codexTitleLine(sessionId, 'Codex only')]);

    // When / Then: each agent reads only its own source, if it supports titles.
    for (const [agent, title] of [
      ['claude', 'Claude only'],
      ['codex', 'Codex only'],
      ['antigravity', undefined],
      ['cursor', undefined],
    ] as const) {
      const payload = runHelper(
        agent,
        'complete',
        'stop',
        { session_id: sessionId, transcript_path: transcriptPath, transcriptPath },
        { CODEX_HOME: codexHome },
      );
      expect(payload.agent).toBe(agent);
      expect(payload.sessionTitle).toBe(title);
    }
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
