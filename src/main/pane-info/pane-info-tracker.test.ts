import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeInfo } from '../../shared/types';
import { PaneInfoTracker } from './pane-info-tracker';
import type { PaneInfoChangedEvent, ProcessTableRow } from './types';

function shellRow(tpgid: number): ProcessTableRow {
  return {
    pid: 123,
    ppid: 1,
    pgid: 123,
    tpgid,
    command: '/bin/zsh',
    args: '/bin/zsh -l',
  };
}

function expectedInfo(
  overrides: Partial<PaneRuntimeInfo> & Pick<PaneRuntimeInfo, 'ptyId' | 'observedAt'>,
): PaneRuntimeInfo {
  const processActivity = overrides.processActivity ?? overrides.activity ?? 'idle';
  return {
    activity: processActivity,
    processActivity,
    foregroundSession: { kind: processActivity === 'idle' ? 'none' : 'other' },
    integration: {
      shell: false,
      protocols: [],
      lastSequenceAt: 0,
      stale: false,
    },
    ...overrides,
  };
}

describe('PaneInfoTracker', () => {
  let rows: ProcessTableRow[];
  let now: number;
  let onChanged: ReturnType<typeof vi.fn<(event: PaneInfoChangedEvent) => void>>;
  let tracker: PaneInfoTracker;

  beforeEach(() => {
    rows = [shellRow(123)];
    now = 1000;
    onChanged = vi.fn<(event: PaneInfoChangedEvent) => void>();
    tracker = new PaneInfoTracker({
      callbacks: { onChanged },
      inspector: {
        listProcesses: vi.fn(() => Promise.resolve(rows)),
      },
      now: () => now,
      pollIntervalMs: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers panes with an initial idle snapshot', () => {
    // Given: a tracker with no panes.

    // When: a PTY is registered.
    tracker.register('pty-1', 123);

    // Then: the initial runtime info is available and emitted.
    const info = expectedInfo({ ptyId: 'pty-1', observedAt: 1000 });
    expect(tracker.list()).toEqual([info]);
    expect(onChanged).toHaveBeenCalledWith({
      info,
    });
  });

  it('emits only when activity or foreground command changes', async () => {
    // Given: a registered pane starts idle.
    tracker.register('pty-1', 123);
    onChanged.mockClear();

    // When: polling observes the same idle state.
    now = 1001;
    await tracker.poll();

    // Then: the timestamp updates without sending a redundant event.
    expect(tracker.list()).toEqual([expectedInfo({ ptyId: 'pty-1', observedAt: 1001 })]);
    expect(onChanged).not.toHaveBeenCalled();

    // When: a foreground process becomes active.
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/make',
        args: 'make test',
      },
    ];
    now = 1002;
    await tracker.poll();

    // Then: the running state is emitted.
    expect(onChanged).toHaveBeenCalledWith({
      info: expectedInfo({
        ptyId: 'pty-1',
        processActivity: 'running',
        foregroundCommand: 'make test',
        observedAt: 1002,
      }),
    });
  });

  it('prefers the submitted terminal command while a process is running', async () => {
    // Given: a pane has a user-submitted command before ps observes its child process.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    tracker.notifyCommand('pty-1', 'pnpm run dev');
    onChanged.mockClear();

    // When: ps reports the foreground process as the resolved node executable.
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/Users/tester/.local/share/mise/installs/node/24.11.0/bin/node',
        args: 'node /Users/tester/.local/share/mise/installs/node/24.11.0/bin/pnpm.cjs run dev',
      },
    ];
    now = 1002;
    await tracker.poll();

    // Then: the sidebar-facing info keeps the command the user actually submitted.
    expect(onChanged).toHaveBeenCalledWith({
      info: expectedInfo({
        ptyId: 'pty-1',
        processActivity: 'running',
        foregroundCommand: 'pnpm run dev',
        observedAt: 1002,
      }),
    });
  });

  it('keeps activity and processActivity equal during migration', async () => {
    // Given: a registered pane has a foreground process.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/make',
        args: 'make test',
      },
    ];

    // When: polling emits running state.
    now = 1002;
    await tracker.poll();

    // Then: legacy and new activity fields carry the same value.
    const [info] = tracker.list();
    expect(info?.activity).toBe('running');
    expect(info?.processActivity).toBe('running');
  });

  it('records shell integration protocols when signals are applied directly', () => {
    // Given: a registered pane.
    tracker.register('pty-1', 123);
    onChanged.mockClear();

    // When: duplicate lifecycle sources are observed by the tracker.
    now = 1002;
    tracker.applySignal('pty-1', { type: 'shell-prompt-start', source: 'osc133' });
    tracker.applySignal('pty-1', { type: 'shell-prompt-start', source: 'osc133' });
    tracker.applySignal('pty-1', { type: 'shell-prompt-end', source: 'osc633' });

    // Then: protocols are retained once in observation order.
    const [info] = tracker.list();
    expect(info?.integration).toEqual({
      shell: true,
      protocols: ['osc133', 'osc633'],
      lastSequenceAt: 1002,
      stale: false,
    });
  });

  it('creates command state from shell integration signals without register.ts wiring', () => {
    // Given: a registered pane receives shell integration signals directly.
    tracker.register('pty-1', 123);

    // When: command line and start signals are applied.
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the new runtime info shape can represent the in-flight command.
    expect(tracker.list()[0]).toMatchObject({
      ptyId: 'pty-1',
      processActivity: 'running',
      foregroundCommand: 'pnpm test',
      command: {
        line: 'pnpm test',
        startedAt: 1002,
        source: 'shell-integration',
      },
    });
  });

  it('overwrites stale in-flight command state when a new command start arrives', () => {
    // Given: a previous command start did not receive D or a prompt-start cleanup.
    tracker.register('pty-1', 123);
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // When: the next command start arrives with a newer command line.
    now = 2000;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm build',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the latest command start recovers the tracker state.
    expect(tracker.list()[0]).toMatchObject({
      command: {
        line: 'pnpm build',
        startedAt: 2000,
        source: 'shell-integration',
      },
      foregroundCommand: 'pnpm build',
    });
  });

  it('clears the shell integration command line on shell-command-finished before the next poll', async () => {
    // Given: a pane is observed as running a node process and shell integration is in flight.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/node',
        args: 'node /Users/tester/project/server.js',
      },
    ];
    now = 1002;
    await tracker.poll();
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // When: the command finishes via OSC 133;D before the next ps poll observes the transition.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 0,
    });

    // Then: the finished command is captured and the stale shell-integration command line does not
    // stick around as the display value before ps has a chance to refresh.
    const [info] = tracker.list();
    expect(info?.command).toMatchObject({
      line: 'pnpm test',
      finishedAt: 1003,
      exitCode: 0,
    });
    expect(info?.foregroundCommand).toBe('node /Users/tester/project/server.js');
  });

  it('clears the shell integration command line on shell-command-finished even when the matching command-started was missed', async () => {
    // Given: 633;E is observed but the matching 133;C is dropped, so shellIntegrationCommandLine
    // is populated while currentCommand stays undefined.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });

    // When: 133;D arrives without a matching 133;C, then ps observes ssh as the new foreground.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 0,
    });
    rows = [
      shellRow(789),
      {
        pid: 789,
        ppid: 123,
        pgid: 789,
        tpgid: 789,
        command: '/usr/bin/ssh',
        args: '/usr/bin/ssh user@host',
      },
    ];
    now = 1004;
    await tracker.poll();

    // Then: the stale 633;E command line does not outrank the freshly observed ssh foreground.
    const [info] = tracker.list();
    expect(info?.foregroundSession).toEqual({ kind: 'ssh' });
    expect(info?.foregroundCommand).toBe('/usr/bin/ssh user@host');
  });

  it('clears the shell integration command line when ps transitions to idle without a matching command-started', async () => {
    // Given: 633;E is observed but the matching 133;C is dropped, leaving the OSC command line
    // dangling while a separate foreground process is observed by ps.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/node',
        args: 'node /Users/tester/project/server.js',
      },
    ];
    now = 1002;
    await tracker.poll();
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });

    // When: ps next observes the pane back at the shell prompt (idle).
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();

    // Then: the running→idle cleanup path drops the stale shell-integration command line so the
    // pane no longer displays a foreground command at all.
    const [info] = tracker.list();
    expect(info?.processActivity).toBe('idle');
    expect(info?.foregroundCommand).toBeUndefined();
  });

  it('switches the foreground command to ssh once ps observes an ssh foreground process', async () => {
    // Given: a local command has completed and shell integration recorded its command line.
    tracker.register('pty-1', 123);
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 0,
    });

    // When: the user runs `ssh user@host` and ps now reports ssh as the foreground process.
    rows = [
      shellRow(789),
      {
        pid: 789,
        ppid: 123,
        pgid: 789,
        tpgid: 789,
        command: '/usr/bin/ssh',
        args: '/usr/bin/ssh user@host',
      },
    ];
    now = 1004;
    await tracker.poll();

    // Then: the sidebar displays the new local foreground (ssh) rather than the previous command.
    const [info] = tracker.list();
    expect(info?.processActivity).toBe('running');
    expect(info?.foregroundSession).toEqual({ kind: 'ssh' });
    expect(info?.foregroundCommand).toBe('/usr/bin/ssh user@host');
  });

  it('unregisters panes and clears runtime info', () => {
    // Given: a registered pane.
    tracker.register('pty-1', 123);

    // When: the pane is unregistered.
    tracker.unregister('pty-1');

    // Then: it no longer appears in snapshots.
    expect(tracker.list()).toEqual([]);
  });

  it('restarts recurring polling when pollIntervalMs changes', async () => {
    // Given: a tracker with recurring polling enabled.
    vi.useFakeTimers();
    const listProcesses = vi.fn(() => Promise.resolve(rows));
    tracker = new PaneInfoTracker({
      callbacks: { onChanged },
      inspector: { listProcesses },
      now: () => now,
      pollIntervalMs: 1000,
    });
    tracker.register('pty-1', 123);
    await vi.runOnlyPendingTimersAsync();
    listProcesses.mockClear();

    // When: the interval is shortened and enough time elapses for one new tick.
    tracker.setPollIntervalMs(250);
    await vi.advanceTimersByTimeAsync(250);

    // Then: polling uses the new cadence.
    expect(listProcesses).toHaveBeenCalledOnce();
  });

  it('disables recurring polling when pollIntervalMs is non-positive', async () => {
    // Given: a tracker with recurring polling enabled.
    vi.useFakeTimers();
    const listProcesses = vi.fn(() => Promise.resolve(rows));
    tracker = new PaneInfoTracker({
      callbacks: { onChanged },
      inspector: { listProcesses },
      now: () => now,
      pollIntervalMs: 1000,
    });
    tracker.register('pty-1', 123);
    await vi.runOnlyPendingTimersAsync();
    listProcesses.mockClear();

    // When: polling is disabled.
    tracker.setPollIntervalMs(0);
    await vi.advanceTimersByTimeAsync(5000);

    // Then: no recurring polls run.
    expect(listProcesses).not.toHaveBeenCalled();
  });
});
