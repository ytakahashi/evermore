import type { IPty, IPtyForkOptions, IDisposable } from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, type LogRecord, type LogTransport } from '../logging/logger';
import type { ShellIntegrationInjector } from '../shell-integration/injector';
import { PtyManager } from './pty-manager';
import { TerminalSignalParser } from './terminal-signal-parser';
import type {
  PtyCreateEvent,
  PtyDataEvent,
  PtyDisposeEvent,
  PtyExitEvent,
  PtySignalEvent,
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
  let onSignal: ReturnType<typeof vi.fn<(event: PtySignalEvent) => void>>;
  let onUserInput: ReturnType<typeof vi.fn<(event: { id: string }) => void>>;
  let manager: PtyManager;

  beforeEach(() => {
    fakePty = createFakePty();
    spawn = vi.fn((_file: string, _args: string[] | string, _options: IPtyForkOptions) => fakePty);
    onData = vi.fn();
    onExit = vi.fn();
    onCreate = vi.fn<(event: PtyCreateEvent) => void>();
    onDispose = vi.fn<(event: PtyDisposeEvent) => void>();
    onSignal = vi.fn<(event: PtySignalEvent) => void>();
    onUserInput = vi.fn<(event: { id: string }) => void>();
    manager = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose, onSignal, onUserInput },
      spawn,
      getHomeDirectory: () => '/Users/tester',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a PTY and forwards process output through callbacks', () => {
    // Given: a manager using a mocked `node-pty.spawn`.

    // When: a PTY is created and emits output.
    const id = manager.create({ cwd: '/missing', shell: '/bin/zsh', cols: 100, rows: 30 });
    fakePty.emitData('hello');

    // Then: creation options are normalized and output is tagged with the runtime id.
    expect(spawn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-l'],
      expect.objectContaining({
        cols: 100,
        cwd: '/Users/tester',
        name: 'xterm-256color',
        rows: 30,
      }),
    );
    expect(onData).toHaveBeenCalledWith({ id, data: 'hello' });
    expect(onCreate).toHaveBeenCalledWith({ id, pid: 1234, cwd: '/Users/tester' });
  });

  it('merges shell-integration env extras into the spawn env when an injector is provided', () => {
    // Given: a fake injector that asks for the standard ZDOTDIR injection keys.
    const injectorExtras = {
      ZDOTDIR: '/tmp/evermore-zdotdir',
      EVERMORE_INJECT_ZDOTDIR: '/tmp/evermore-zdotdir',
      EVERMORE_ORIGINAL_ZDOTDIR_SET: '0',
      EVERMORE_ORIGINAL_ZDOTDIR: '',
    };
    const envExtrasForShell = vi.fn<
      (shell: string, baseEnv: NodeJS.ProcessEnv) => Record<string, string>
    >(() => injectorExtras);
    const injector = {
      envExtrasForShell,
      setAutoInject: vi.fn(),
      getDirectory: vi.fn(() => '/tmp/evermore-zdotdir'),
    } as unknown as ShellIntegrationInjector;
    const managerWithInjector = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose, onSignal },
      spawn,
      getHomeDirectory: () => '/Users/tester',
      shellIntegrationInjector: injector,
    });

    // When: the manager spawns a PTY with a pane-level ZDOTDIR override.
    managerWithInjector.create({
      cwd: '/Users/tester',
      env: { ZDOTDIR: '/Users/tester/.config/zsh' },
    });

    // Then: the injector saw the pane-level override as the baseEnv ZDOTDIR, and its extras
    // override that value in the final spawn env. TERM_PROGRAM=Evermore still wins on top.
    const baseEnvSeenByInjector = envExtrasForShell.mock.calls[0]?.[1];
    expect(baseEnvSeenByInjector?.['ZDOTDIR']).toBe('/Users/tester/.config/zsh');
    const spawnedEnv = spawn.mock.calls[0]?.[2]?.env ?? {};
    expect(spawnedEnv['ZDOTDIR']).toBe('/tmp/evermore-zdotdir');
    expect(spawnedEnv['EVERMORE_INJECT_ZDOTDIR']).toBe('/tmp/evermore-zdotdir');
    expect(spawnedEnv['EVERMORE_ORIGINAL_ZDOTDIR_SET']).toBe('0');
    expect(spawnedEnv['TERM_PROGRAM']).toBe('Evermore');
  });

  it('does not inject any ZDOTDIR keys when the injector returns undefined', () => {
    // Given: an injector that opts out (e.g. auto-inject is off, or the shell is bash).
    const injector = {
      envExtrasForShell: vi.fn(() => undefined),
      setAutoInject: vi.fn(),
      getDirectory: vi.fn(() => '/tmp/evermore-zdotdir'),
    } as unknown as ShellIntegrationInjector;
    const managerWithInjector = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose, onSignal },
      spawn,
      getHomeDirectory: () => '/Users/tester',
      shellIntegrationInjector: injector,
    });

    // When: a PTY is created with no ZDOTDIR in the pane env.
    managerWithInjector.create({ cwd: '/Users/tester' });

    // Then: no Evermore-specific ZDOTDIR keys leak into the spawn env.
    const spawnedEnv = spawn.mock.calls[0]?.[2]?.env ?? {};
    expect(spawnedEnv['EVERMORE_INJECT_ZDOTDIR']).toBeUndefined();
    expect(spawnedEnv['EVERMORE_ORIGINAL_ZDOTDIR_SET']).toBeUndefined();
    expect(spawnedEnv['EVERMORE_ORIGINAL_ZDOTDIR']).toBeUndefined();
  });

  it('sets TERM_PROGRAM=Evermore so the shell integration snippet identifies Evermore panes', () => {
    // Given: a parent process whose TERM_PROGRAM identifies a different terminal emulator.
    const originalTermProgram = process.env['TERM_PROGRAM'];
    process.env['TERM_PROGRAM'] = 'iTerm.app';

    try {
      // When: the manager spawns a PTY.
      manager.create({ cwd: '/Users/tester' });

      // Then: the spawn env identifies the host terminal as Evermore, overriding the parent value.
      const spawnedEnv = spawn.mock.calls[0]?.[2]?.env ?? {};
      expect(spawnedEnv['TERM_PROGRAM']).toBe('Evermore');
    } finally {
      if (originalTermProgram === undefined) {
        delete process.env['TERM_PROGRAM'];
      } else {
        process.env['TERM_PROGRAM'] = originalTermProgram;
      }
    }
  });

  it('injects Evermore PTY and pane identifiers into the spawn env', () => {
    // Given: a pane-scoped PTY create request.

    // When: the manager spawns the PTY.
    const id = manager.create({ cwd: '/Users/tester', paneId: 'pane-1' });

    // Then: hooks inside the shell can identify both the runtime PTY and persisted pane.
    const spawnedEnv = spawn.mock.calls[0]?.[2]?.env ?? {};
    expect(spawnedEnv['EVERMORE_PTY_ID']).toBe(id);
    expect(spawnedEnv['EVERMORE_PANE_ID']).toBe('pane-1');
  });

  it('writes and resizes the active PTY', () => {
    // Given: a live PTY id owned by the manager.
    const id = manager.create({ cwd: '/Users/tester' });

    // When: renderer-originated input and dimensions are forwarded.
    manager.write(id, 'ls\r');
    manager.resize(id, 120.9, 33.7);

    // Then: node-pty receives sanitized operations for that process.
    expect(fakePty.write).toHaveBeenCalledWith('ls\r');
    expect(onUserInput).toHaveBeenCalledWith({ id });
    expect(fakePty.resize).toHaveBeenCalledWith(120, 33);
  });

  it('does not emit user-input observations for unknown PTYs or empty writes', () => {
    // Given: a live PTY id owned by the manager.
    const id = manager.create({ cwd: '/Users/tester' });
    onUserInput.mockClear();

    // When: an empty write and an unknown write are requested.
    manager.write(id, '');
    manager.write('missing', 'ignored');

    // Then: no user-input observation is emitted.
    expect(onUserInput).not.toHaveBeenCalled();
  });

  it('disposes a PTY and ignores later operations for that id', () => {
    // Given: a live PTY id owned by the manager.
    const parserDispose = vi.spyOn(TerminalSignalParser.prototype, 'dispose');
    const id = manager.create({ cwd: '/Users/tester' });

    // When: the PTY is explicitly disposed.
    manager.dispose(id);
    manager.write(id, 'ignored');
    manager.resize(id, 120, 33);

    // Then: listeners are cleaned up, the process is killed, and the id is no longer usable.
    expect(fakePty.dataDisposable.dispose).toHaveBeenCalledOnce();
    expect(fakePty.exitDisposable.dispose).toHaveBeenCalledOnce();
    expect(parserDispose).toHaveBeenCalledOnce();
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

  it('emits terminal runtime signals while preserving raw PTY data forwarding', () => {
    // Given: a live PTY id and output containing a supported OSC signal.
    const id = manager.create({ cwd: '/Users/tester' });
    const data = '\x1b]133;C\x07terminal output';

    // When: the PTY emits the raw data chunk.
    fakePty.emitData(data);

    // Then: the parser emits a typed signal and the original output still reaches the renderer.
    expect(onSignal).toHaveBeenCalledWith({
      id,
      signal: { type: 'shell-command-started', source: 'osc133' },
    });
    expect(onData).toHaveBeenCalledWith({ id, data });
    expect(onSignal.mock.invocationCallOrder[0]).toBeLessThan(onData.mock.invocationCallOrder[0]);
  });

  it('translates OSC 777 parser drops into a logger.debug observation', () => {
    // Given: a manager with a recording logger and a live PTY.
    const records: LogRecord[] = [];
    const transport: LogTransport = {
      write(record) {
        records.push(record);
      },
    };
    const logger = createLogger({ level: 'debug', transport });
    const localPty = createFakePty();
    const localSpawn = vi.fn<PtySpawn>().mockReturnValue(localPty);
    const managerWithLogger = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose, onSignal },
      spawn: localSpawn,
      getHomeDirectory: () => '/Users/tester',
      logger,
    });
    managerWithLogger.create({ cwd: '/Users/tester' });

    // When: a malformed Evermore OSC 777 payload arrives from the PTY.
    localPty.emitData('\x1b]777;evermore;not-json\x07');

    // Then: the parser's drop reason is recorded as a debug entry on the injected logger.
    expect(records).toEqual([
      expect.objectContaining({
        level: 'debug',
        message: 'osc-777 dropped',
        meta: { reason: 'malformed JSON' },
      }),
    ]);
  });

  it('keeps forwarding raw PTY data when terminal signal observation throws', () => {
    // Given: a manager whose signal callback fails.
    onSignal.mockImplementation(() => {
      throw new Error('signal callback failed');
    });
    const id = manager.create({ cwd: '/Users/tester' });
    const data = '\x1b]133;C\x07terminal output';

    // When: the PTY emits output containing a signal.
    fakePty.emitData(data);

    // Then: signal observer failure is contained by the parser and raw data is still forwarded.
    expect(onSignal).toHaveBeenCalledWith({
      id,
      signal: { type: 'shell-command-started', source: 'osc133' },
    });
    expect(onData).toHaveBeenCalledWith({ id, data });
  });

  it('does not require an onSignal callback', () => {
    // Given: a manager constructed without the optional signal callback.
    const managerWithoutSignal = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose },
      spawn,
      getHomeDirectory: () => '/Users/tester',
    });
    managerWithoutSignal.create({ cwd: '/Users/tester' });

    // When / Then: signal-bearing output is still safe to observe.
    expect(() => {
      fakePty.emitData('\x1b]133;C\x07');
    }).not.toThrow();
  });

  it('keeps parser state independent per PTY', () => {
    // Given: two live PTYs emit split OSC sequences independently.
    const firstPty = createFakePty();
    const secondPty = createFakePty();
    spawn = vi.fn<PtySpawn>().mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    manager = new PtyManager({
      callbacks: { onData, onExit, onCreate, onDispose, onSignal },
      spawn,
      getHomeDirectory: () => '/Users/tester',
    });
    const firstId = manager.create({ cwd: '/Users/tester' });
    const secondId = manager.create({ cwd: '/Users/tester' });

    // When: each PTY completes a different split sequence.
    firstPty.emitData('\x1b]133;');
    secondPty.emitData('\x1b]633;');
    firstPty.emitData('C\x07');
    secondPty.emitData('A\x07');

    // Then: signals are attributed to the PTY whose parser assembled each sequence.
    expect(onSignal).toHaveBeenCalledWith({
      id: firstId,
      signal: { type: 'shell-command-started', source: 'osc133' },
    });
    expect(onSignal).toHaveBeenCalledWith({
      id: secondId,
      signal: { type: 'shell-prompt-start', source: 'osc633' },
    });
  });
});
