// @vitest-environment node

/**
 * End-to-end verification of the ZDOTDIR-based shell-integration auto-injection path.
 *
 * The existing `shell-integration.e2e.test.ts` suite covers the snippet itself by writing it
 * directly into a temporary `.zshrc`. This suite exercises the auto-injection flow on top:
 * `ShellIntegrationInjector` materializes the forwarding scripts into a temp ZDOTDIR, and we
 * spawn `/bin/zsh -l -i -d` with the resulting env extras. The forwarding chain must source the
 * snippet from `.zshrc`, emit the usual OSC lifecycle signals, and finalize cleanup at the end
 * of `.zlogin` so the auto-injection state does not leak into subshells started inside the PTY.
 *
 * Linux CI without `/bin/zsh` skips this suite. macOS developers should run `pnpm test` locally
 * after changing the forwarding-script builders or the injector.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TerminalSignalParser } from '../../src/main/pty/terminal-signal-parser';
import { ShellIntegrationInjector } from '../../src/main/shell-integration/injector';
import type { PaneRuntimeSignal } from '../../src/shared/pane-runtime-signal';

const ZSH_PATH = '/bin/zsh';
const hasZsh = existsSync(ZSH_PATH);

/** Per-command timeout. Real zsh -l -i -d startup takes <200ms locally; 5s is a generous ceiling. */
const PROMPT_TIMEOUT_MS = 5000;

describe.skipIf(!hasZsh)('Evermore shell-integration auto-injection (real zsh)', () => {
  let userDataDir: string;
  let homeDir: string;
  let injector: ShellIntegrationInjector;
  let pty: IPty;
  let session: ShellSession;

  beforeEach(async () => {
    // Two separate temp dirs: one for the Evermore-managed ZDOTDIR (where forwarding scripts
    // live), one for HOME (where the user's rc files would live if any). Both start empty so
    // the developer's real environment cannot leak in.
    userDataDir = mkdtempSync(join(tmpdir(), 'evermore-shell-inject-e2e-userdata-'));
    homeDir = mkdtempSync(join(tmpdir(), 'evermore-shell-inject-e2e-home-'));
    injector = new ShellIntegrationInjector({
      userDataDir,
      initialAutoInject: true,
    });

    session = new ShellSession();
    const extras = injector.envExtrasForShell(ZSH_PATH, {});
    if (!extras) {
      throw new Error('Expected the injector to return env extras for /bin/zsh');
    }
    pty = nodePty.spawn(ZSH_PATH, ['-l', '-i', '-d'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homeDir,
      env: buildCleanEnv(homeDir, extras),
    });
    pty.onData((data) => session.applyChunk(data));

    // After the forwarding chain finishes (.zshenv → .zprofile → .zshrc + snippet → .zlogin +
    // finalize), zle-line-init emits OSC 133;B. Waiting for it synchronizes us to "shell ready
    // for input" without depending on raw byte parsing.
    await session.waitForReady();
  });

  afterEach(() => {
    pty.kill();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('sources the snippet via forwarding scripts and emits OSC lifecycle signals', async () => {
    const startIndex = session.signalCount;
    pty.write('echo hi\r');
    await session.waitForReady(startIndex);

    const newSignals = session.signalsSince(startIndex);
    expect(newSignals).toEqual(
      expect.arrayContaining<PaneRuntimeSignal>([
        { type: 'shell-command-line', command: 'echo hi', source: 'osc633' },
        { type: 'shell-command-started', source: 'osc133' },
        { type: 'shell-command-finished', source: 'osc133', exitCode: 0 },
        { type: 'shell-prompt-start', source: 'osc133' },
        { type: 'shell-prompt-end', source: 'osc133' },
      ]),
    );
  });

  it('finalizes ZDOTDIR and unsets EVERMORE_* env so subshells do not inherit the injection', async () => {
    // Probe the post-finalize env by writing it to a temp file. Parsing stdout would be brittle
    // because prompts and OSC sequences interleave with command output; a file is unambiguous.
    const probePath = join(homeDir, 'env-probe.txt');
    const startIndex = session.signalCount;
    pty.write(
      `printf '%s\\n' "ZDOTDIR=\${ZDOTDIR-UNSET}" "EVERMORE_INJECT_ZDOTDIR=\${EVERMORE_INJECT_ZDOTDIR-UNSET}" "EVERMORE_ORIGINAL_ZDOTDIR_SET=\${EVERMORE_ORIGINAL_ZDOTDIR_SET-UNSET}" > ${probePath}\r`,
    );
    await session.waitForReady(startIndex);

    // The auto-injection contract is: after .zlogin finalizes, both the user-visible ZDOTDIR
    // (originally unset in this test's clean env) and every EVERMORE_* helper var are unset so
    // a `zsh` subshell started inside the Evermore PTY sees no trace of the injection.
    const probe = readFileSync(probePath, 'utf8');
    expect(probe).toContain('ZDOTDIR=UNSET');
    expect(probe).toContain('EVERMORE_INJECT_ZDOTDIR=UNSET');
    expect(probe).toContain('EVERMORE_ORIGINAL_ZDOTDIR_SET=UNSET');
  });

  it('runs the snippet idempotently when the manual snippet is also present in the user rc', async () => {
    // The design's compatibility contract: a user who pasted the manual snippet into ~/.zshrc
    // before auto-injection shipped should not get double registration. The forwarding `.zshrc`
    // sources the user's ~/.zshrc first (which sets EVERMORE_SHELL_INTEGRATION=1) and then
    // sources the auto-injected copy, which must early-return on the sentinel guard.
    pty.kill();
    rmSync(homeDir, { recursive: true, force: true });

    homeDir = mkdtempSync(join(tmpdir(), 'evermore-shell-inject-e2e-home-'));
    const { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } =
      await import('../../src/shared/shell-integration/zsh-snippet');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(homeDir, '.zshrc'), EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET);

    session = new ShellSession();
    const extras = injector.envExtrasForShell(ZSH_PATH, {});
    if (!extras) {
      throw new Error('Expected the injector to return env extras for /bin/zsh');
    }
    pty = nodePty.spawn(ZSH_PATH, ['-l', '-i', '-d'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: homeDir,
      env: buildCleanEnv(homeDir, extras),
    });
    pty.onData((data) => session.applyChunk(data));
    await session.waitForReady();

    // Counting registered zsh hooks is the load-bearing assertion: the snippet's installer
    // appends to preexec / precmd / chpwd via `add-zsh-hook`, so a double-registration would
    // double every entry. Probing $preexec_functions etc. via `print` is the closest thing to a
    // "how many hooks are installed" measurement.
    const probePath = join(homeDir, 'hooks-probe.txt');
    const startIndex = session.signalCount;
    pty.write(
      `print -l -- "\${(j[,])preexec_functions}" "\${(j[,])precmd_functions}" "\${(j[,])chpwd_functions}" > ${probePath}\r`,
    );
    await session.waitForReady(startIndex);

    // Each Evermore hook name must appear exactly once across its slot. If the manual paste and
    // the auto-injected source both ran their installers, each name would appear twice (joined
    // by commas via the `j[,]` flag).
    const probe = readFileSync(probePath, 'utf8');
    expect(occurrencesOf(probe, '_evermore_preexec')).toBe(1);
    expect(occurrencesOf(probe, '_evermore_precmd')).toBe(1);
    expect(occurrencesOf(probe, '_evermore_chpwd')).toBe(1);
  });
});

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
   * Resolves once an `OSC 133;B` marker has been observed at or after `afterIndex`.
   *
   * Callers must capture `signalCount` *before* writing to the PTY so a marker that arrives
   * between the write and the `await` is not missed.
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
 *
 * The injector-supplied `extras` (ZDOTDIR + EVERMORE_*) override any inherited values, exactly
 * the way `PtyManager.create` layers them in production.
 */
function buildCleanEnv(home: string, extras: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  delete env['VSCODE_INJECTION'];
  delete env['VSCODE_GIT_IPC_HANDLE'];
  delete env['EVERMORE_SHELL_INTEGRATION'];
  delete env['ZDOTDIR'];
  delete env['EVERMORE_INJECT_ZDOTDIR'];
  delete env['EVERMORE_ORIGINAL_ZDOTDIR'];
  delete env['EVERMORE_ORIGINAL_ZDOTDIR_SET'];

  env['TERM'] = 'xterm-256color';
  env['TERM_PROGRAM'] = 'Evermore';
  env['HOME'] = home;

  return { ...env, ...extras };
}

function occurrencesOf(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const next = haystack.indexOf(needle, from);
    if (next === -1) {
      return count;
    }
    count += 1;
    from = next + needle.length;
  }
  return count;
}
