import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as nodePty from 'node-pty';
import type { IDisposable, IPty } from 'node-pty';
import type { ShellIntegrationInjector } from '../shell-integration/injector';
import { buildPtyProcessEnv } from './pty-env';
import { TerminalSignalParser } from './terminal-signal-parser';
import type { PtyCreateOptions, PtyManagerCallbacks, PtyManagerOptions, PtySpawn } from './types';

interface PtyRecord {
  proc: IPty;
  disposables: IDisposable[];
  parser: TerminalSignalParser;
}

/**
 * Owns pseudoterminal processes for the main process and exposes a small id-based API for IPC.
 *
 * The renderer never receives `node-pty` objects directly. Keeping lifecycle ownership here makes
 * the IPC boundary serializable and gives future workspace restore code a single place to dispose
 * runtime-only processes.
 */
export class PtyManager {
  private readonly ptys = new Map<string, PtyRecord>();
  private readonly callbacks: PtyManagerCallbacks;
  private readonly spawn: PtySpawn;
  private readonly getHomeDirectory: () => string;
  private readonly shellIntegrationInjector: ShellIntegrationInjector | undefined;

  public constructor(options: PtyManagerOptions) {
    this.callbacks = options.callbacks;
    this.spawn = options.spawn ?? nodePty.spawn;
    this.getHomeDirectory = options.getHomeDirectory ?? homedir;
    this.shellIntegrationInjector = options.shellIntegrationInjector;
  }

  /**
   * Starts a shell-backed PTY and returns the runtime id used by renderer IPC calls.
   */
  public create(options: PtyCreateOptions): string {
    const id = randomUUID();
    const shell = options.shell ?? process.env['SHELL'] ?? '/bin/zsh';
    const resolvedCwd = this.resolveCwd(options.cwd);
    // Start the shell as a login shell so macOS's `/etc/zprofile` runs `path_helper`, populating
    // PATH from `/etc/paths` and `/etc/paths.d/*` (Homebrew, cryptex, MacPorts, etc.). Without
    // `-l` the spawned PATH would diverge from what the user sees in iTerm2 or Terminal.app.
    //
    // `-l` is understood by zsh, bash, and fish, which covers the realistic SHELL values on macOS.
    // If a user runs an exotic shell that rejects `-l`, this would need to branch on the shell
    // name. Login mode also runs `~/.zprofile`; any TTY-unsafe output there can leak into the
    // initial pane render, but in practice profile files are quiet.
    // Build the pre-injection view of env so the shell-integration injector can record the user's
    // pre-Evermore ZDOTDIR even when a pane-level override carries one. The injector merges its
    // own keys on top of this view, and `buildPtyProcessEnv` applies them last so they survive
    // the PATH/locale normalization.
    const paneEnv: Record<string, string> = options.env ?? {};
    const preInjectionEnv: NodeJS.ProcessEnv = { ...process.env, ...paneEnv };
    const shellIntegrationExtras = this.shellIntegrationInjector?.envExtrasForShell(
      shell,
      preInjectionEnv,
    );

    const proc = this.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: resolvedCwd,
      env: {
        ...buildPtyProcessEnv(process.env, {
          ...paneEnv,
          ...(shellIntegrationExtras ?? {}),
        }),
        EVERMORE_PTY_ID: id,
        ...(options.paneId ? { EVERMORE_PANE_ID: options.paneId } : {}),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        // Override any inherited TERM_PROGRAM (e.g. iTerm.app / WezTerm when Evermore was launched
        // from another terminal) so the shell-integration snippet can identify Evermore panes and
        // skip its "another host's shell integration is already active" early return.
        TERM_PROGRAM: 'Evermore',
      },
    });

    const parser = new TerminalSignalParser({
      emit: (signal) => {
        this.callbacks.onSignal?.({ id, signal });
      },
    });

    const dataDisposable = proc.onData((data) => {
      parser.applyChunk(data);
      this.callbacks.onData({ id, data });
    });
    const exitDisposable = proc.onExit(({ exitCode }) => {
      this.disposeRecord(id);
      this.callbacks.onExit({ id, code: exitCode });
    });

    // Store listener disposables with the PTY so exit-driven cleanup and explicit disposal follow
    // the same path. That keeps stale callbacks from writing to a recycled renderer pane later.
    this.ptys.set(id, {
      proc,
      disposables: [dataDisposable, exitDisposable],
      parser,
    });
    this.callbacks.onCreate?.({ id, pid: proc.pid, cwd: resolvedCwd });

    return id;
  }

  /**
   * Writes user input from the renderer into the PTY if it is still alive.
   */
  public write(id: string, data: string): void {
    const record = this.ptys.get(id);
    if (!record) {
      return;
    }

    record.proc.write(data);
    if (data !== '') {
      this.callbacks.onUserInput?.({ id });
    }
  }

  /**
   * Resizes the PTY to match xterm.js dimensions.
   */
  public resize(id: string, cols: number, rows: number): void {
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
      return;
    }

    this.ptys.get(id)?.proc.resize(Math.floor(cols), Math.floor(rows));
  }

  /**
   * Disposes a single PTY and terminates the backing process.
   */
  public dispose(id: string): void {
    const record = this.disposeRecord(id);
    record?.proc.kill();
  }

  /**
   * Disposes all active PTYs during app shutdown or IPC teardown.
   */
  public disposeAll(): void {
    for (const id of [...this.ptys.keys()]) {
      this.dispose(id);
    }
  }

  private resolveCwd(cwd: string): string {
    if (!cwd) {
      return this.getHomeDirectory();
    }

    try {
      if (existsSync(cwd) && statSync(cwd).isDirectory()) {
        return cwd;
      }
    } catch (_error: unknown) {
      // A workspace can outlive deleted or unmounted directories. Falling back avoids making app
      // startup depend on old filesystem state; Phase 1 does not surface recovery UI yet.
    }

    return this.getHomeDirectory();
  }

  private disposeRecord(id: string): PtyRecord | undefined {
    const record = this.ptys.get(id);
    if (!record) {
      return undefined;
    }

    for (const disposable of record.disposables) {
      disposable.dispose();
    }
    record.parser.dispose();
    this.ptys.delete(id);
    this.callbacks.onDispose?.({ id });
    return record;
  }
}
