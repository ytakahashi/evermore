// @vitest-environment node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as nodePty from 'node-pty';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVERMORE_AGENT_STATUS_HELPER_SCRIPT } from '../../src/shared/ai-integration/snippets';

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;

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
