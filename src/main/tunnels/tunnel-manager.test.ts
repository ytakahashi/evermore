import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TunnelManager } from './tunnel-manager';
import type { TunnelLogEvent, TunnelSpawn, TunnelStatusChangedEvent } from './types';

class FakeTunnelProcess extends EventEmitter {
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killSignals: Array<NodeJS.Signals | number | undefined> = [];
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public killed = false;

  public constructor(public readonly pid: number) {
    super();
  }

  public readonly kill = vi.fn((signal?: NodeJS.Signals | number): boolean => {
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  });

  public writeStdout(data: string): void {
    this.stdout.write(data);
  }

  public writeStderr(data: string): void {
    this.stderr.write(data);
  }

  public emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  public emitError(error: Error): void {
    this.emit('error', error);
  }
}

describe('TunnelManager', () => {
  let now: number;
  let spawnedProcesses: FakeTunnelProcess[];
  let spawn: ReturnType<typeof vi.fn<TunnelSpawn>>;
  let onStatusChanged: ReturnType<typeof vi.fn<(event: TunnelStatusChangedEvent) => void>>;
  let onLog: ReturnType<typeof vi.fn<(event: TunnelLogEvent) => void>>;
  let manager: TunnelManager;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    spawnedProcesses = [];
    spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => {
      const proc = new FakeTunnelProcess(1000 + spawnedProcesses.length);
      spawnedProcesses.push(proc);
      return proc as unknown as ChildProcess;
    });
    onStatusChanged = vi.fn();
    onLog = vi.fn();
    manager = new TunnelManager(
      { onStatusChanged, onLog },
      {
        spawn,
        now: () => now,
        startupGraceMs: 1500,
        killGraceMs: 2000,
        logBufferSize: 3,
      },
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('promotes a live process from starting to running after startup grace', () => {
    // Given: a tunnel manager with a mocked process spawner.

    // When: a tunnel is started and remains alive through the grace period.
    manager.start('dev');
    now = 1500;
    vi.advanceTimersByTime(1500);

    // Then: the ssh command is spawned and runtime state reaches running.
    expect(spawn).toHaveBeenCalledWith('ssh', ['-N', 'dev'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'running',
      pid: 1000,
      startedAt: 1500,
    });
    expect(onStatusChanged).toHaveBeenNthCalledWith(1, {
      alias: 'dev',
      status: 'starting',
      error: undefined,
    });
    expect(onStatusChanged).toHaveBeenNthCalledWith(2, {
      alias: 'dev',
      status: 'running',
      error: undefined,
    });
  });

  it('marks an early zero-code exit as stopped', () => {
    // Given: a tunnel process in startup grace.
    manager.start('dev');

    // When: ssh exits cleanly before it is promoted to running.
    spawnedProcesses[0]?.emitExit(0);
    vi.advanceTimersByTime(1500);

    // Then: the tunnel is stopped and the grace timer does not promote it later.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'stopped',
      pid: undefined,
      startedAt: undefined,
    });
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      alias: 'dev',
      status: 'stopped',
      error: undefined,
    });
  });

  it('uses the last stderr line as the error for a non-zero exit', () => {
    // Given: ssh writes a useful failure reason to stderr.
    manager.start('dev');
    spawnedProcesses[0]?.writeStderr('bind failed\n');

    // When: the process exits with a non-zero code.
    spawnedProcesses[0]?.emitExit(255);

    // Then: the tunnel enters error state with that stderr line.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'error',
      lastError: 'bind failed',
    });
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      alias: 'dev',
      status: 'error',
      error: 'bind failed',
    });
  });

  it('falls back to exit code when non-zero exit has no stderr', () => {
    // Given: ssh exits without a stderr message.
    manager.start('dev');

    // When: the process exits with a non-zero code.
    spawnedProcesses[0]?.emitExit(1);

    // Then: the exit code is surfaced as the error.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'error',
      lastError: 'exit code 1',
    });
  });

  it('treats an unexpected signal exit as an error', () => {
    // Given: a tunnel has reached running state.
    manager.start('dev');
    vi.advanceTimersByTime(1500);

    // When: ssh exits from a signal that was not requested by the manager.
    spawnedProcesses[0]?.emitExit(null, 'SIGTERM');

    // Then: the signal is reported as an error.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'error',
      lastError: 'signal SIGTERM',
    });
  });

  it('treats a user-requested signal exit as stopped', () => {
    // Given: a running tunnel.
    manager.start('dev');
    vi.advanceTimersByTime(1500);

    // When: the user stops it and ssh exits from SIGTERM.
    manager.stop('dev');
    spawnedProcesses[0]?.emitExit(null, 'SIGTERM');

    // Then: the expected signal shutdown is not reported as a failure.
    expect(spawnedProcesses[0]?.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'stopped',
      lastError: undefined,
    });
  });

  it('does not promote a starting tunnel to running after stop is requested', () => {
    // Given: a tunnel is still inside startup grace.
    manager.start('dev');
    vi.advanceTimersByTime(1499);

    // When: the user stops it just before startup grace would promote it.
    manager.stop('dev');
    vi.advanceTimersByTime(1);

    // Then: no transient running status is broadcast after the stop request.
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      alias: 'dev',
      status: 'starting',
      error: undefined,
    });

    // When: ssh later exits from the requested SIGTERM.
    spawnedProcesses[0]?.emitExit(null, 'SIGTERM');

    // Then: the next status is stopped.
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      alias: 'dev',
      status: 'stopped',
      error: undefined,
    });
  });

  it('marks a spawn error event as error', () => {
    // Given: a spawned process that fails before exit.
    manager.start('dev');

    // When: child_process emits an error.
    spawnedProcesses[0]?.emitError(new Error('ssh not found'));

    // Then: the error message is stored and broadcast.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'error',
      lastError: 'ssh not found',
    });
    expect(onStatusChanged).toHaveBeenLastCalledWith({
      alias: 'dev',
      status: 'error',
      error: 'ssh not found',
    });
  });

  it('ignores an exit event after a spawn error has already settled state', () => {
    // Given: a child process reports a spawn failure.
    manager.start('dev');
    spawnedProcesses[0]?.emitError(new Error('ssh not found'));

    // When: an exit event arrives later for the same failed process.
    spawnedProcesses[0]?.emitExit(0);

    // Then: the original error state is preserved.
    expect(manager.getRuntimeState('dev')).toMatchObject({
      status: 'error',
      lastError: 'ssh not found',
    });
    expect(onStatusChanged).toHaveBeenCalledTimes(2);
  });

  it('keeps duplicate starts as a no-op while a tunnel is active', () => {
    // Given: a tunnel is already starting.
    manager.start('dev');

    // When: start is called again for the same alias.
    manager.start('dev');

    // Then: only one process is spawned.
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('escalates stop from SIGTERM to SIGKILL after kill grace', () => {
    // Given: a running tunnel whose process does not exit after SIGTERM.
    manager.start('dev');
    vi.advanceTimersByTime(1500);

    // When: the tunnel is stopped and the kill grace elapses.
    manager.stop('dev');
    vi.advanceTimersByTime(1999);

    // Then: only SIGTERM has been sent so far.
    expect(spawnedProcesses[0]?.killSignals).toEqual(['SIGTERM']);

    // When: the final millisecond elapses.
    vi.advanceTimersByTime(1);

    // Then: the manager escalates to SIGKILL.
    expect(spawnedProcesses[0]?.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('does not escalate to SIGKILL after the process exits', () => {
    // Given: a running tunnel is stopped.
    manager.start('dev');
    vi.advanceTimersByTime(1500);
    manager.stop('dev');

    // When: ssh exits before the kill grace expires.
    spawnedProcesses[0]?.emitExit(null, 'SIGTERM');
    vi.advanceTimersByTime(2000);

    // Then: no SIGKILL is sent.
    expect(spawnedProcesses[0]?.killSignals).toEqual(['SIGTERM']);
  });

  it('disposes all running tunnels with graceful shutdown and escalation', () => {
    // Given: two running tunnels.
    manager.start('dev-a');
    manager.start('dev-b');
    vi.advanceTimersByTime(1500);

    // When: the manager is disposed and processes remain alive.
    manager.disposeAll();
    vi.advanceTimersByTime(2000);

    // Then: every live tunnel receives SIGTERM followed by SIGKILL.
    expect(spawnedProcesses[0]?.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(spawnedProcesses[1]?.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('disposes starting tunnels and ignores already settled tunnels', () => {
    // Given: one starting tunnel, one cleanly stopped tunnel, and one error tunnel.
    manager.start('starting');
    manager.start('stopped');
    spawnedProcesses[1]?.emitExit(0);
    manager.start('failed');
    spawnedProcesses[2]?.emitError(new Error('ssh not found'));

    // When: the manager is disposed and the starting process remains alive.
    manager.disposeAll();
    vi.advanceTimersByTime(2000);

    // Then: only the still-active tunnel is terminated.
    expect(spawnedProcesses[0]?.killSignals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(spawnedProcesses[1]?.killSignals).toEqual([]);
    expect(spawnedProcesses[2]?.killSignals).toEqual([]);
  });

  it('keeps a FIFO ring buffer of recent log lines', () => {
    // Given: the manager has a log buffer size of three.
    manager.start('dev');

    // When: four complete log lines are emitted.
    spawnedProcesses[0]?.writeStdout('one\n');
    spawnedProcesses[0]?.writeStdout('two\n');
    spawnedProcesses[0]?.writeStderr('three\n');
    spawnedProcesses[0]?.writeStdout('four\n');

    // Then: the oldest line is discarded from the runtime snapshot.
    expect(manager.logs('dev')).toEqual([
      '1970-01-01T00:00:00.000Z two',
      '1970-01-01T00:00:00.000Z three',
      '1970-01-01T00:00:00.000Z four',
    ]);
    expect(onLog).toHaveBeenCalledTimes(4);
  });

  it('preserves partial lines across chunks before logging them', () => {
    // Given: stdout delivers one logical line across multiple chunks.
    manager.start('dev');

    // When: the newline arrives in a later chunk.
    spawnedProcesses[0]?.writeStdout('partial ');
    spawnedProcesses[0]?.writeStdout('line\nnext');

    // Then: only the completed line is logged.
    expect(manager.logs('dev')).toEqual(['1970-01-01T00:00:00.000Z partial line']);

    // When: the process exits with an unterminated pending fragment.
    spawnedProcesses[0]?.emitExit(0);

    // Then: the pending fragment is flushed for the final snapshot.
    expect(manager.logs('dev')).toEqual([
      '1970-01-01T00:00:00.000Z partial line',
      '1970-01-01T00:00:00.000Z next',
    ]);
  });

  it('returns snapshots that cannot mutate manager state', () => {
    // Given: a tunnel has one recent log line.
    manager.start('dev');
    spawnedProcesses[0]?.writeStdout('line\n');

    // When: callers mutate returned snapshots.
    const state = manager.getRuntimeState('dev');
    const logs = manager.logs('dev');
    state?.recentLogs.push('mutated');
    logs.push('mutated');

    // Then: internal state remains unchanged.
    expect(manager.logs('dev')).toEqual(['1970-01-01T00:00:00.000Z line']);
  });
});
