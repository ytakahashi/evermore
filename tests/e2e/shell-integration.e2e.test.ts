// @vitest-environment node

/**
 * End-to-end verification that the Evermore zsh shell integration snippet emits OSC sequences
 * that the main-process parser and tracker can interpret.
 *
 * The suite spawns a real interactive zsh via `node-pty`, sources the snippet through a temporary
 * `ZDOTDIR/.zshrc`, drives a few command cycles, and asserts that the resulting
 * `PaneRuntimeSignal[]` and final `PaneRuntimeInfo` reflect the session.
 *
 * Linux CI without `/bin/zsh` skips this suite. macOS developers should run `pnpm test` locally
 * after changing `src/shared/shell-integration/zsh-snippet.ts` so this suite executes.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PaneInfoTracker } from '../../src/main/pane-info/pane-info-tracker';
import { TerminalSignalParser } from '../../src/main/pty/terminal-signal-parser';
import type { PaneRuntimeSignal } from '../../src/shared/pane-runtime-signal';
import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from '../../src/shared/shell-integration/zsh-snippet';

const ZSH_PATH = '/bin/zsh';
const hasZsh = existsSync(ZSH_PATH);

/** Per-command timeout. Real zsh -i -d startup takes <100ms locally; 5s is a generous ceiling. */
const PROMPT_TIMEOUT_MS = 5000;

describe.skipIf(!hasZsh)('Evermore zsh shell integration (real zsh)', () => {
  let testDir: string;
  let pty: IPty;
  let session: ShellSession;

  beforeAll(() => {
    // Pre-stage a clean ZDOTDIR so zsh sources only our snippet, not the developer's real
    // `.zshrc`. `zsh -d` disables /etc/zshrc loading; HOME=testDir prevents `~/.zshenv`
    // (read from $HOME regardless of ZDOTDIR) from leaking in.
    testDir = mkdtempSync(join(tmpdir(), 'evermore-shell-integration-e2e-'));
    writeFileSync(join(testDir, '.zshrc'), EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET);
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    session = new ShellSession();
    pty = nodePty.spawn(ZSH_PATH, ['-i', '-d'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: testDir,
      env: buildCleanEnv(testDir),
    });
    pty.onData((data) => session.applyChunk(data));

    // The snippet's installer ends with `_evermore_chpwd` and the first precmd then emits
    // `133;A`, after which zle-line-init emits `133;B`. Waiting for `133;B` synchronizes us
    // to "shell is ready for the next command" without depending on raw byte parsing.
    await session.waitForReady();
  });

  afterEach(() => {
    pty.kill();
  });

  it('emits the lifecycle signals expected for a normal command', async () => {
    const startIndex = session.signalCount;
    pty.write('echo hi; ls\r');
    await session.waitForReady(startIndex);

    const newSignals = session.signalsSince(startIndex);
    expect(newSignals).toEqual(
      expect.arrayContaining<PaneRuntimeSignal>([
        { type: 'shell-command-line', command: 'echo hi; ls', source: 'osc633' },
        { type: 'shell-command-started', source: 'osc133' },
        { type: 'shell-command-finished', source: 'osc133', exitCode: 0 },
        { type: 'shell-prompt-start', source: 'osc133' },
        { type: 'shell-prompt-end', source: 'osc133' },
      ]),
    );
    // OSC 633;E must precede OSC 133;C, and OSC 133;D must precede the next OSC 133;A.
    const indexOf = (predicate: (s: PaneRuntimeSignal) => boolean): number =>
      newSignals.findIndex(predicate);
    expect(indexOf((s) => s.type === 'shell-command-line')).toBeLessThan(
      indexOf((s) => s.type === 'shell-command-started'),
    );
    expect(indexOf((s) => s.type === 'shell-command-finished')).toBeLessThan(
      indexOf((s) => s.type === 'shell-prompt-start'),
    );
  });

  it('round-trips multibyte command lines through OSC 633;E', async () => {
    const startIndex = session.signalCount;
    pty.write('echo 日本\r');
    await session.waitForReady(startIndex);

    expect(session.signalsSince(startIndex)).toContainEqual<PaneRuntimeSignal>({
      type: 'shell-command-line',
      command: 'echo 日本',
      source: 'osc633',
    });
  });

  it('reports non-zero exit codes via OSC 133;D', async () => {
    const startIndex = session.signalCount;
    pty.write('false\r');
    await session.waitForReady(startIndex);

    expect(session.signalsSince(startIndex)).toContainEqual<PaneRuntimeSignal>({
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 1,
    });
  });

  it('updates cwd via OSC 7 when chpwd fires', async () => {
    const startIndex = session.signalCount;
    pty.write('cd /tmp\r');
    await session.waitForReady(startIndex);

    const cwdSignals = session.signalsSince(startIndex).filter((s) => s.type === 'cwd');
    expect(cwdSignals.at(-1)).toEqual<PaneRuntimeSignal>({
      type: 'cwd',
      cwd: '/tmp',
      source: 'osc7',
    });
  });

  it('feeds PaneInfoTracker so PaneRuntimeInfo reflects the live shell integration', async () => {
    const tracker = new PaneInfoTracker({
      callbacks: { onChanged: () => undefined },
      // ps polling would race with the deterministic signal feed below; stub it out.
      inspector: { listProcesses: () => Promise.resolve([]) },
      now: () => 1_000_000,
      pollIntervalMs: 0,
    });
    const ptyId = 'e2e-pty';
    tracker.register(ptyId, pty.pid, '/tmp');
    for (const signal of session.signalsSince(0)) {
      tracker.applySignal(ptyId, signal);
    }

    const startIndex = session.signalCount;
    pty.write('echo tracked\r');
    await session.waitForReady(startIndex);
    for (const signal of session.signalsSince(startIndex)) {
      tracker.applySignal(ptyId, signal);
    }

    const info = tracker.list().find((entry) => entry.ptyId === ptyId);
    expect(info).toBeDefined();
    expect(info?.integration.shell).toBe(true);
    expect(info?.integration.protocols).toEqual(
      expect.arrayContaining(['osc7', 'osc133', 'osc633']),
    );
    expect(info?.command?.line).toBe('echo tracked');
    expect(info?.command?.source).toBe('shell-integration');
    expect(info?.command?.exitCode).toBe(0);
    expect(info?.cwd).toBe(testDir);
  });
});

/**
 * Tracks the parser-emitted signal stream and resolves a waiter whenever the shell becomes ready
 * for the next command (signalled by an `OSC 133;B` emit).
 *
 * `OSC 133;B` is the only marker that fires in both the initial startup path (after the snippet
 * installer runs and the first precmd emits `A`) and the steady-state command cycle
 * (`preexec` → `precmd` → `zle-line-init`). Using a signal-level synchronization point avoids
 * raw byte scanning across chunk boundaries.
 */
class ShellSession {
  private readonly parser: TerminalSignalParser;
  private readonly signals: PaneRuntimeSignal[] = [];
  private waitResolver: (() => void) | null = null;

  public constructor() {
    this.parser = new TerminalSignalParser({
      emit: (signal) => this.onSignal(signal),
    });
  }

  public applyChunk(data: string): void {
    this.parser.applyChunk(data);
  }

  public get signalCount(): number {
    return this.signals.length;
  }

  public signalsSince(index: number): PaneRuntimeSignal[] {
    return this.signals.slice(index);
  }

  /**
   * Resolves when an `OSC 133;B` marker has been observed at or after `afterIndex` in the signal
   * stream.
   *
   * Callers must capture `signalCount` *before* writing to the PTY and pass it as `afterIndex`.
   * Otherwise zsh can emit `133;B` between the write and the `await`, the resolver would never
   * see it, and the suite would flake at the timeout. With the index, an already-arrived marker
   * resolves synchronously.
   */
  public waitForReady(afterIndex = 0): Promise<void> {
    if (this.signals.slice(afterIndex).some((signal) => signal.type === 'shell-prompt-end')) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitResolver = null;
        reject(new Error('Timed out waiting for OSC 133;B (shell prompt-end)'));
      }, PROMPT_TIMEOUT_MS);

      this.waitResolver = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private onSignal(signal: PaneRuntimeSignal): void {
    this.signals.push(signal);
    if (signal.type === 'shell-prompt-end' && this.waitResolver) {
      const resolver = this.waitResolver;
      this.waitResolver = null;
      resolver();
    }
  }
}

/**
 * Builds an environment that isolates zsh from the developer's real rc files while keeping the
 * snippet's TERM_PROGRAM=Evermore guard happy. Strips inherited shell-integration sentinels so
 * the snippet does not skip itself when the developer happens to be running inside VS Code.
 */
function buildCleanEnv(zdotdir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  delete env['VSCODE_INJECTION'];
  delete env['VSCODE_GIT_IPC_HANDLE'];

  env['TERM'] = 'xterm-256color';
  env['TERM_PROGRAM'] = 'Evermore';
  env['HOME'] = zdotdir;
  env['ZDOTDIR'] = zdotdir;

  return env;
}
