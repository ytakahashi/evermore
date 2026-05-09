import type { IPty, IPtyForkOptions, IDisposable } from 'node-pty';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PtyManager } from './pty-manager';
import type {
  PtyCreateEvent,
  PtyDataEvent,
  PtyDisposeEvent,
  PtyExitEvent,
  PtySpawn,
} from './types';

interface FakePty extends IPty {
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
  dataDisposable: IDisposable;
  exitDisposable: IDisposable;
}

function createFakePty(): FakePty {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number }) => void) | null = null;

  const dataDisposable = { dispose: vi.fn() };
  const exitDisposable = { dispose: vi.fn() };

  return {
    pid: 1234,
    cols: 80,
    rows: 24,
    process: 'zsh',
    handleFlowControl: false,
    dataDisposable,
    exitDisposable,
    onData: vi.fn((listener: (data: string) => void) => {
      dataListener = listener;
      return dataDisposable;
    }),
    onExit: vi.fn((listener: (event: { exitCode: number }) => void) => {
      exitListener = listener;
      return exitDisposable;
    }),
    resize: vi.fn(),
    clear: vi.fn(),
    write: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    emitData: (data: string) => {
      dataListener?.(data);
    },
    emitExit: (exitCode: number) => {
      exitListener?.({ exitCode });
    },
  };
}

describe('PtyManager', () => {
  let fakePty: FakePty;
  let spawn: ReturnType<typeof vi.fn<PtySpawn>>;
  let onData: ReturnType<typeof vi.fn<(event: PtyDataEvent) => void>>;
  let onExit: ReturnType<typeof vi.fn<(event: PtyExitEvent) => void>>;
  let onCreate: ReturnType<typeof vi.fn<(event: PtyCreateEvent) => void>>;
  let onDispose: ReturnType<typeof vi.fn<(event: PtyDisposeEvent) => void>>;
  let manager: PtyManager;

  beforeEach(() => {
    fakePty = createFakePty();
    spawn = vi.fn((_file: string, _args: string[] | string, _options: IPtyForkOptions) => fakePty);
    onData = vi.fn();
    onExit = vi.fn();
    onCreate = vi.fn<(event: PtyCreateEvent) => void>();
    onDispose = vi.fn<(event: PtyDisposeEvent) => void>();
    manager = new PtyManager({ onData, onExit, onCreate, onDispose }, spawn, () => '/Users/tester');
  });

  it('creates a PTY and forwards process output through callbacks', () => {
    // Given: a manager using a mocked `node-pty.spawn`.

    // When: a PTY is created and emits output.
    const id = manager.create({ cwd: '/missing', shell: '/bin/zsh', cols: 100, rows: 30 });
    fakePty.emitData('hello');

    // Then: creation options are normalized and output is tagged with the runtime id.
    expect(spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      [],
      expect.objectContaining({
        cols: 100,
        cwd: '/Users/tester',
        name: 'xterm-256color',
        rows: 30,
      }),
    );
    expect(onData).toHaveBeenCalledWith({ id, data: 'hello' });
    expect(onCreate).toHaveBeenCalledWith({ id, pid: 1234 });
  });

  it('writes and resizes the active PTY', () => {
    // Given: a live PTY id owned by the manager.
    const id = manager.create({ cwd: '/Users/tester' });

    // When: renderer-originated input and dimensions are forwarded.
    manager.write(id, 'ls\r');
    manager.resize(id, 120.9, 33.7);

    // Then: node-pty receives sanitized operations for that process.
    expect(fakePty.write).toHaveBeenCalledWith('ls\r');
    expect(fakePty.resize).toHaveBeenCalledWith(120, 33);
  });

  it('disposes a PTY and ignores later operations for that id', () => {
    // Given: a live PTY id owned by the manager.
    const id = manager.create({ cwd: '/Users/tester' });

    // When: the PTY is explicitly disposed.
    manager.dispose(id);
    manager.write(id, 'ignored');
    manager.resize(id, 120, 33);

    // Then: listeners are cleaned up, the process is killed, and the id is no longer usable.
    expect(fakePty.dataDisposable.dispose).toHaveBeenCalledOnce();
    expect(fakePty.exitDisposable.dispose).toHaveBeenCalledOnce();
    expect(fakePty.kill).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledWith({ id });
    expect(fakePty.write).not.toHaveBeenCalledWith('ignored');
    expect(fakePty.resize).not.toHaveBeenCalledWith(120, 33);
  });

  it('cleans up the PTY record when the process exits', () => {
    // Given: a live PTY id owned by the manager.
    const id = manager.create({ cwd: '/Users/tester' });

    // When: the underlying process exits.
    fakePty.emitExit(7);
    manager.write(id, 'ignored');

    // Then: exit is reported and stale renderer operations no longer reach the old process.
    expect(onExit).toHaveBeenCalledWith({ id, code: 7 });
    expect(fakePty.dataDisposable.dispose).toHaveBeenCalledOnce();
    expect(fakePty.exitDisposable.dispose).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledWith({ id });
    expect(fakePty.write).not.toHaveBeenCalledWith('ignored');
  });
});
