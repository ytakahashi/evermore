import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as nodePty from 'node-pty';
import type { IDisposable, IPty } from 'node-pty';
import { buildPtyProcessEnv } from './pty-locale';
import type { PtyCreateOptions, PtyManagerCallbacks, PtySpawn } from './types';

interface PtyRecord {
  proc: IPty;
  disposables: IDisposable[];
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

  public constructor(
    private readonly callbacks: PtyManagerCallbacks,
    private readonly spawn: PtySpawn = nodePty.spawn,
    private readonly getHomeDirectory: () => string = homedir,
  ) {}

  /**
   * Starts a shell-backed PTY and returns the runtime id used by renderer IPC calls.
   */
  public create(options: PtyCreateOptions): string {
    const id = randomUUID();
    const shell = options.shell ?? process.env['SHELL'] ?? '/bin/zsh';
    const proc = this.spawn(shell, [], {
      name: 'xterm-256color',
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: this.resolveCwd(options.cwd),
      env: {
        ...buildPtyProcessEnv(process.env, options.env),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });

    const dataDisposable = proc.onData((data) => {
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
    });
    this.callbacks.onCreate?.({ id, pid: proc.pid });

    return id;
  }

  /**
   * Writes user input from the renderer into the PTY if it is still alive.
   */
  public write(id: string, data: string): void {
    this.ptys.get(id)?.proc.write(data);
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
    this.ptys.delete(id);
    this.callbacks.onDispose?.({ id });
    return record;
  }
}
