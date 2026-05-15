import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { TUNNEL_LOG_BUFFER_SIZE } from '../../shared/tunnel-constants';
import type { TunnelStatus } from '../../shared/types';
import type { TunnelManagerCallbacks, TunnelRuntimeState, TunnelSpawn } from './types';

interface TunnelManagerOptions {
  spawn?: TunnelSpawn;
  now?: () => number;
  startupGraceMs?: number;
  killGraceMs?: number;
  logBufferSize?: number;
}

interface TunnelRecord extends TunnelRuntimeState {
  alias: string;
  process?: ChildProcess;
  startupTimer?: ReturnType<typeof setTimeout>;
  killTimer?: ReturnType<typeof setTimeout>;
  exited: boolean;
  stopRequested: boolean;
  pendingStdout: string;
  pendingStderr: string;
  lastStderrLine?: string;
}

const DEFAULT_STARTUP_GRACE_MS = 1500;
const DEFAULT_KILL_GRACE_MS = 2000;

/**
 * Owns SSH tunnel processes and exposes serializable runtime state for main-process IPC.
 */
export class TunnelManager {
  private readonly records = new Map<string, TunnelRecord>();
  private readonly spawn: TunnelSpawn;
  private readonly now: () => number;
  private readonly startupGraceMs: number;
  private readonly killGraceMs: number;
  private readonly logBufferSize: number;

  public constructor(
    private readonly callbacks: TunnelManagerCallbacks,
    options: TunnelManagerOptions = {},
  ) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.now = options.now ?? Date.now;
    this.startupGraceMs = options.startupGraceMs ?? DEFAULT_STARTUP_GRACE_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.logBufferSize = options.logBufferSize ?? TUNNEL_LOG_BUFFER_SIZE;
  }

  /**
   * Starts `ssh -N <alias>` unless the alias already has a live startup or running process.
   */
  public start(alias: string): void {
    const existingRecord = this.records.get(alias);
    if (existingRecord?.status === 'starting' || existingRecord?.status === 'running') {
      return;
    }

    const record = this.createRecord(alias, existingRecord);
    this.records.set(alias, record);

    try {
      const proc = this.spawn('ssh', ['-N', alias], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });
      record.process = proc;
      record.pid = proc.pid;

      this.attachLogStream(record, proc.stdout, 'stdout');
      this.attachLogStream(record, proc.stderr, 'stderr');

      proc.on('error', (error: Error) => {
        this.handleProcessError(record, error);
      });
      proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        this.handleProcessExit(record, code, signal);
      });

      this.setStatus(record, 'starting');
      record.startupTimer = setTimeout(() => {
        if (this.records.get(alias) === record && !record.exited) {
          this.setStatus(record, 'running');
        }
      }, this.startupGraceMs);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(record, 'error', message);
    }
  }

  /**
   * Stops a live tunnel process with SIGTERM, then SIGKILL if it ignores the graceful shutdown.
   */
  public stop(alias: string): void {
    const record = this.records.get(alias);
    if (!record || record.status === 'stopped' || record.status === 'error') {
      return;
    }

    this.terminateRecord(record);
  }

  /**
   * Returns a snapshot of runtime state for one alias, if the manager has seen it.
   */
  public getRuntimeState(alias: string): TunnelRuntimeState | undefined {
    const record = this.records.get(alias);
    return record ? this.toRuntimeState(record) : undefined;
  }

  /**
   * Returns snapshots for aliases that have runtime state in memory.
   */
  public list(): Array<{ alias: string; state: TunnelRuntimeState }> {
    return [...this.records.values()].map((record) => ({
      alias: record.alias,
      state: this.toRuntimeState(record),
    }));
  }

  /**
   * Returns the recent log snapshot for one alias.
   */
  public logs(alias: string): string[] {
    return [...(this.records.get(alias)?.recentLogs ?? [])];
  }

  /**
   * Terminates all active tunnels during app shutdown or IPC teardown.
   */
  public disposeAll(): void {
    for (const record of this.records.values()) {
      if (record.status === 'starting' || record.status === 'running') {
        this.terminateRecord(record);
      }
    }
  }

  private createRecord(alias: string, existingRecord: TunnelRecord | undefined): TunnelRecord {
    this.clearTimers(existingRecord);

    return {
      alias,
      status: 'stopped',
      pid: undefined,
      startedAt: undefined,
      lastError: undefined,
      recentLogs: existingRecord?.recentLogs ? [...existingRecord.recentLogs] : [],
      process: undefined,
      exited: false,
      stopRequested: false,
      pendingStdout: '',
      pendingStderr: '',
      lastStderrLine: undefined,
    };
  }

  private attachLogStream(
    record: TunnelRecord,
    stream: Readable | null,
    streamName: 'stdout' | 'stderr',
  ): void {
    stream?.on('data', (chunk: Buffer | string) => {
      this.appendChunk(record, streamName, chunk.toString());
    });
  }

  private appendChunk(record: TunnelRecord, streamName: 'stdout' | 'stderr', chunk: string): void {
    const pending = streamName === 'stdout' ? record.pendingStdout : record.pendingStderr;
    const lines = `${pending}${chunk}`.split(/\r?\n/);
    const nextPending = lines.pop() ?? '';

    if (streamName === 'stdout') {
      record.pendingStdout = nextPending;
    } else {
      record.pendingStderr = nextPending;
    }

    for (const line of lines) {
      this.appendLogLine(record, streamName, line);
    }
  }

  private flushPendingLogs(record: TunnelRecord): void {
    if (record.pendingStdout) {
      this.appendLogLine(record, 'stdout', record.pendingStdout);
      record.pendingStdout = '';
    }
    if (record.pendingStderr) {
      this.appendLogLine(record, 'stderr', record.pendingStderr);
      record.pendingStderr = '';
    }
  }

  private appendLogLine(record: TunnelRecord, streamName: 'stdout' | 'stderr', line: string): void {
    if (streamName === 'stderr') {
      record.lastStderrLine = line;
    }

    const timestampedLine = `${new Date(this.now()).toISOString()} ${line}`;
    record.recentLogs.push(timestampedLine);
    if (record.recentLogs.length > this.logBufferSize) {
      record.recentLogs.splice(0, record.recentLogs.length - this.logBufferSize);
    }
    this.callbacks.onLog({ alias: record.alias, line: timestampedLine });
  }

  private handleProcessError(record: TunnelRecord, error: Error): void {
    if (this.records.get(record.alias) !== record || record.exited) {
      return;
    }

    record.exited = true;
    this.clearTimers(record);
    this.flushPendingLogs(record);
    this.setStatus(record, 'error', error.message);
    record.process = undefined;
    record.pid = undefined;
  }

  private handleProcessExit(
    record: TunnelRecord,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.records.get(record.alias) !== record || record.exited) {
      return;
    }

    record.exited = true;
    this.clearTimers(record);
    this.flushPendingLogs(record);
    record.process = undefined;
    record.pid = undefined;

    if (record.stopRequested || code === 0) {
      this.setStatus(record, 'stopped');
      return;
    }

    const errorMessage =
      record.lastStderrLine ?? (signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`);
    this.setStatus(record, 'error', errorMessage);
  }

  private terminateRecord(record: TunnelRecord): void {
    record.stopRequested = true;
    this.clearTimers(record);

    // A user-requested stop is allowed to surface as a signal exit from `ssh`. The flag above keeps
    // that expected SIGTERM/SIGKILL path in the `stopped` state instead of misclassifying it as an
    // unexpected tunnel failure.
    record.process?.kill('SIGTERM');
    record.killTimer = setTimeout(() => {
      if (this.records.get(record.alias) === record && !record.exited) {
        record.process?.kill('SIGKILL');
      }
    }, this.killGraceMs);
  }

  private setStatus(record: TunnelRecord, status: TunnelStatus, error?: string): void {
    record.status = status;
    if (status === 'starting') {
      record.lastError = undefined;
    }
    if (status === 'running') {
      record.startedAt = this.now();
    }
    if (status === 'stopped') {
      record.startedAt = undefined;
    }
    if (error !== undefined) {
      record.lastError = error;
    }

    this.callbacks.onStatusChanged({ alias: record.alias, status, error });
  }

  private toRuntimeState(record: TunnelRecord): TunnelRuntimeState {
    return {
      status: record.status,
      pid: record.pid,
      startedAt: record.startedAt,
      lastError: record.lastError,
      recentLogs: [...record.recentLogs],
    };
  }

  private clearTimers(record: TunnelRecord | undefined): void {
    if (!record) {
      return;
    }
    if (record.startupTimer) {
      clearTimeout(record.startupTimer);
      record.startupTimer = undefined;
    }
    this.clearKillTimer(record);
  }

  private clearKillTimer(record: TunnelRecord): void {
    if (record.killTimer) {
      clearTimeout(record.killTimer);
      record.killTimer = undefined;
    }
  }
}
