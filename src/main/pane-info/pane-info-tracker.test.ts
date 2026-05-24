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
  const processActivity = overrides.processActivity ?? 'idle';
  return {
    processActivity,
    foregroundSession: { kind: processActivity === 'idle' ? 'none' : 'other' },
    integration: {
      shell: false,
      protocols: [],
      lastSequenceAt: 0,
      stale: false,
    },
    // Every `tracker.register(...)` call in this suite seeds cwd with '/tmp', so the helper
    // defaults to the same value. Override `cwd` explicitly when a test exercises OSC 7 / chpwd.
    cwd: '/tmp',
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
    tracker.register('pty-1', 123, '/tmp');

    // Then: the initial runtime info is available and emitted.
    const info = expectedInfo({ ptyId: 'pty-1', observedAt: 1000 });
    expect(tracker.list()).toEqual([info]);
    expect(onChanged).toHaveBeenCalledWith({
      info,
    });
  });

  it('emits only when activity or foreground command changes', async () => {
    // Given: a registered pane starts idle.
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');
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

  it('records shell integration protocols when signals are applied directly', () => {
    // Given: a registered pane.
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');

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
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');
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
    tracker.register('pty-1', 123, '/tmp');
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

  it('does not promote processActivity to running for shell-command-line without a matching shell-command-started', async () => {
    // Given: a pane is idle and no shell-command-started has been observed.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    onChanged.mockClear();

    // When: only a shell-command-line is applied without the matching 133;C.
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });

    // Then: the pane stays idle and the OSC command line does not surface as foregroundCommand.
    const [info] = tracker.list();
    expect(info?.processActivity).toBe('idle');
    expect(info?.foregroundCommand).toBeUndefined();
  });

  it('records lastCommand with exitCode on shell-command-finished and resets currentCommand', async () => {
    // Given: a pane has a shell integration command in flight.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // When: 133;D arrives with an exit code.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 42,
    });

    // Then: the in-flight command is finished and the next emitted command snapshot reflects
    // lastCommand, including finishedAt and exitCode.
    const [info] = tracker.list();
    expect(info?.command).toEqual({
      line: 'pnpm test',
      startedAt: 1002,
      finishedAt: 1003,
      exitCode: 42,
      source: 'shell-integration',
    });
  });

  it('records lastCommand with undefined exitCode when ps transitions to idle without 133;D', async () => {
    // Given: ps observes a foreground process while shell integration reports an in-flight command.
    tracker.register('pty-1', 123, '/tmp');
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
    now = 1002;
    await tracker.poll();
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // When: ps observes the pane back at the shell prompt before 133;D is received.
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();

    // Then: the pseudo finish leaves exitCode undefined so it can be told apart from exit 0.
    const [info] = tracker.list();
    expect(info?.command).toMatchObject({
      line: 'pnpm test',
      startedAt: 1002,
      finishedAt: 1003,
      source: 'shell-integration',
    });
    expect(info?.command?.exitCode).toBeUndefined();
  });

  it('keeps shellIntegrationCommandLine and missedPsCommandStarts unchanged when remote shell-command-line arrives during an ssh session', async () => {
    // Given: shell integration was observed locally and ps already pushed integration into stale,
    // then ssh takes over as the local foreground process.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    tracker.applySignal('pty-1', { type: 'shell-prompt-start', source: 'osc133' });
    const localRunning = [
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
    rows = localRunning;
    now = 1002;
    await tracker.poll();
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();
    rows = localRunning;
    now = 1004;
    await tracker.poll();
    rows = [shellRow(123)];
    now = 1005;
    await tracker.poll();
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
    now = 1006;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('ssh');
    expect(tracker.list()[0]?.integration.stale).toBe(true);

    // When: a remote shell-command-line arrives while ssh is the local foreground.
    now = 1007;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'vim foo.c',
      source: 'osc633',
    });

    // Then: missedPsCommandStarts has not been reset by the SSH-guarded 633;E path so stale stays
    // true, and foregroundCommand keeps showing the local ssh process.
    expect(tracker.list()[0]?.foregroundCommand).toBe('/usr/bin/ssh user@host');
    expect(tracker.list()[0]?.integration.stale).toBe(true);

    // When: ps transitions directly from ssh (running) to another non-ssh foreground (running)
    // without going through idle. Going through idle would otherwise fire the running→idle
    // cleanup path that clears shellIntegrationCommandLine and mask whether the SSH-guarded
    // 633;E set it. running→running keeps any leaked state intact for the next assertion.
    rows = localRunning;
    now = 1008;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('other');

    // When: a local shell-command-started fires without a preceding 633;E. currentCommand.line is
    // populated from shellIntegrationCommandLine at this moment.
    now = 1009;
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the new currentCommand.line stays empty. If the SSH-guarded 633;E earlier had
    // populated shellIntegrationCommandLine (regression), 'vim foo.c' would leak into the next
    // local command lifecycle here instead.
    expect(tracker.list()[0]?.command).toMatchObject({
      line: '',
      startedAt: 1009,
      source: 'shell-integration',
    });
  });

  it('keeps processActivity running when remote shell-command-finished arrives during an ssh session', async () => {
    // Given: ps observes ssh as the local foreground process.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    now = 1002;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('ssh');

    // When: the remote shell signals shell-command-finished while the ssh process is still alive.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-finished',
      source: 'osc133',
      exitCode: 0,
    });

    // Then: the local processActivity stays running so the sidebar keeps the ssh running marker.
    expect(tracker.list()[0]?.processActivity).toBe('running');
  });

  it('only skips OSC 7 cwd updates after the foreground process is classified as ssh', async () => {
    // The SSH cwd guard in `applyCwd` keys on `foregroundSession.kind`, which is derived from the
    // most recent `ps` observation. OSC 7 that arrives before any matching `ps` row has classified
    // the foreground process is therefore still written to `PaneRuntimeInfo.cwd`. This test pins
    // both halves of that behaviour together so the guard's reliance on the ps-derived session
    // classification is explicit, not accidental.

    // Given: a fresh pane with no ps observation yet — foregroundSession defaults to 'none'.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('none');

    // When: an OSC 7 arrives before ps has had a chance to classify the foreground process.
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'cwd',
      cwd: '/remote/path',
      source: 'osc7',
    });

    // Then: cwd is updated because the guard has no ssh classification to skip on yet.
    expect(tracker.list()[0]?.cwd).toBe('/remote/path');

    // And: once ps confirms ssh as the foreground process, later OSC 7 updates are skipped.
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
    now = 1003;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('ssh');
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'cwd',
      cwd: '/another/remote',
      source: 'osc7',
    });
    expect(tracker.list()[0]?.cwd).toBe('/remote/path');
  });

  it('resumes OSC 7 cwd writes once the ssh foreground session ends', async () => {
    // Pins the recovery half of the SSH cwd invariant. The companion test above only confirms
    // that `applyCwd` skips while `foregroundSession.kind === 'ssh'`; without this case a future
    // change that made the SSH skip sticky (e.g. caching the flag on the process record) would
    // still pass the "block during ssh" assertion. We need both halves pinned.

    // Given: ps classifies the local foreground as ssh after an initial local cwd was recorded.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'cwd',
      cwd: '/Users/local/project',
      source: 'osc7',
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
    now = 1003;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('ssh');
    // Confirm the SSH skip is active before exercising recovery — a remote cwd is rejected.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'cwd',
      cwd: '/remote/path',
      source: 'osc7',
    });
    expect(tracker.list()[0]?.cwd).toBe('/Users/local/project');

    // When: ssh exits, ps observes the shell back in the foreground, and a fresh OSC 7 arrives.
    rows = [shellRow(123)];
    now = 1005;
    await tracker.poll();
    expect(tracker.list()[0]?.foregroundSession.kind).toBe('none');
    now = 1006;
    tracker.applySignal('pty-1', {
      type: 'cwd',
      cwd: '/Users/local/after-ssh',
      source: 'osc7',
    });

    // Then: the cwd is written through again because the SSH classification is gone.
    expect(tracker.list()[0]?.cwd).toBe('/Users/local/after-ssh');
  });

  it('toggles integration.stale when ps repeatedly misses command starts and a shell-command-started resets the counter', async () => {
    // Given: shell integration was observed.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    tracker.applySignal('pty-1', { type: 'shell-prompt-start', source: 'osc133' });

    // When: ps records two non-ssh idle→running transitions without matching OSC.
    const localRunning = [
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
    rows = localRunning;
    now = 1002;
    await tracker.poll();
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();
    rows = localRunning;
    now = 1004;
    await tracker.poll();

    // Then: integration becomes stale after the second missed command start.
    expect(tracker.list()[0]?.integration.stale).toBe(true);

    // When: a shell-command-started signal arrives.
    now = 1005;
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: missedPsCommandStarts is reset and stale flips back to false.
    expect(tracker.list()[0]?.integration.stale).toBe(false);
  });

  it('swaps foregroundCommand priority between OSC and fallback when integration toggles stale and recovers', async () => {
    // Given: shell integration is active with both a fallback submitted command and a 633;E line.
    tracker.register('pty-1', 123, '/tmp');
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
      command: 'pnpm dev',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    tracker.notifyCommand('pty-1', 'pnpm run dev');

    // Then (sanity): while integration is fresh, the OSC command line wins.
    expect(tracker.list()[0]?.foregroundCommand).toBe('pnpm dev');

    // When: ps records two more idle→running transitions so missedPsCommandStarts crosses the
    // stale threshold without a matching 133;C reset.
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();
    rows = [
      shellRow(789),
      {
        pid: 789,
        ppid: 123,
        pgid: 789,
        tpgid: 789,
        command: '/usr/bin/make',
        args: 'make test',
      },
    ];
    now = 1004;
    await tracker.poll();
    rows = [shellRow(123)];
    now = 1005;
    await tracker.poll();
    rows = [
      shellRow(789),
      {
        pid: 789,
        ppid: 123,
        pgid: 789,
        tpgid: 789,
        command: '/usr/bin/make',
        args: 'make test',
      },
    ];
    now = 1006;
    await tracker.poll();

    // Then: integration goes stale and the priority order flips so the user-submitted command
    // wins over the now-suspect OSC command line.
    const staleInfo = tracker.list()[0];
    expect(staleInfo?.integration.stale).toBe(true);
    expect(staleInfo?.foregroundCommand).toBe('pnpm run dev');

    // When: a fresh shell-command-started signal arrives and resets missedPsCommandStarts.
    now = 1007;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm build',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: integration recovers and the OSC command line is primary again.
    const recoveredInfo = tracker.list()[0];
    expect(recoveredInfo?.integration.stale).toBe(false);
    expect(recoveredInfo?.foregroundCommand).toBe('pnpm build');
  });

  it('unregisters panes and clears runtime info', () => {
    // Given: a registered pane.
    tracker.register('pty-1', 123, '/tmp');

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
    tracker.register('pty-1', 123, '/tmp');
    await vi.runOnlyPendingTimersAsync();
    listProcesses.mockClear();

    // When: the interval is shortened and enough time elapses for one new tick.
    tracker.setPollIntervalMs(250);
    await vi.advanceTimersByTimeAsync(250);

    // Then: polling uses the new cadence.
    expect(listProcesses).toHaveBeenCalledOnce();
  });

  it('suppresses subsequent shell-integration signals after an ssh shell-command-line and before ps catches up', async () => {
    // Given: a fresh pane with no ps observation yet. ssh is launched via shell integration.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'ssh host',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // When: remote OSC arrives before the next ps tick. The remote shell emits its own command
    // line and lifecycle markers, which would otherwise overwrite the local ssh command record and
    // surface a remote agent.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'claude',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the local pane keeps the ssh command record, foregroundCommand reflects ssh (not
    // claude), and no agent is reported. This pins the race window contract: until ps confirms
    // the foreground process, the early-detection flag must absorb remote-origin signals.
    const [info] = tracker.list();
    expect(info?.foregroundCommand).toBe('ssh host');
    expect(info?.command).toMatchObject({ line: 'ssh host', source: 'shell-integration' });
    expect(info?.agent).toBeUndefined();
  });

  it('releases the ssh early-detection flag on the next ps tick so post-ssh local updates apply normally', async () => {
    // Given: ssh was launched via shell-integration, so the early-detection flag is active.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'ssh host',
      source: 'osc633',
    });

    // When: ps observes the shell back at the prompt without ever classifying ssh (for example
    // because the ssh launch failed instantly). The next ps tick must release the flag so the
    // pane can accept normal shell-integration updates again.
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();
    expect(tracker.list()[0]).toMatchObject({
      processActivity: 'idle',
      command: {
        line: 'ssh host',
        source: 'shell-integration',
        finishedAt: 1003,
      },
    });
    expect(tracker.list()[0]?.foregroundCommand).toBeUndefined();

    // And: a fresh local command-line arrives after the prompt.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the post-ssh command is recorded normally; the early-detection flag did not stick.
    const [info] = tracker.list();
    expect(info?.foregroundCommand).toBe('pnpm test');
    expect(info?.command).toMatchObject({ line: 'pnpm test', source: 'shell-integration' });
  });

  it('reports a ready agent while a known AI agent is the foreground process', async () => {
    // Given: a pane has a known agent (`claude`) as the foreground process.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/opt/homebrew/bin/claude',
        args: '/opt/homebrew/bin/claude',
      },
    ];

    // When: the next poll observes the agent.
    now = 1002;
    await tracker.poll();

    // Then: the runtime info carries an agent slot in the `ready` state. Working / awaiting-input
    // require an explicit signal source that command-line detection cannot synthesize, so
    // command-line detection always reports `ready`.
    const [info] = tracker.list();
    expect(info?.agent).toEqual({
      known: 'claude',
      kind: 'claude',
      status: 'ready',
      source: 'command-line',
      observedAt: 1002,
    });
  });

  it('does not set an agent while an ssh session is the foreground process', async () => {
    // Given: a pane runs ssh locally; the remote shell can legitimately invoke an agent, but the
    // local foreground classification is ssh.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(789),
      {
        pid: 789,
        ppid: 123,
        pgid: 789,
        tpgid: 789,
        command: '/usr/bin/ssh',
        args: '/usr/bin/ssh host claude',
      },
    ];

    // When: the next poll classifies the foreground session as ssh.
    now = 1002;
    await tracker.poll();

    // Then: even though the args mention `claude`, no local agent is reported. Remote-agent
    // surfacing would need its own runtime field rather than overloading the local one.
    const [info] = tracker.list();
    expect(info?.foregroundSession.kind).toBe('ssh');
    expect(info?.agent).toBeUndefined();
  });

  it('clears the agent when the foreground process returns to the shell prompt', async () => {
    // Given: a pane is observed running `claude`.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: 'claude',
        args: 'claude',
      },
    ];
    now = 1002;
    await tracker.poll();
    expect(tracker.list()[0]?.agent?.known).toBe('claude');

    // When: ps sees the pane back at the shell prompt.
    rows = [shellRow(123)];
    now = 1003;
    await tracker.poll();

    // Then: the agent slot is cleared so the sidebar falls back to the terminal icon.
    expect(tracker.list()[0]?.agent).toBeUndefined();
  });

  it('preserves observedAt while the detected agent identity is unchanged', async () => {
    // Given: `claude` is detected.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: 'claude',
        args: 'claude',
      },
    ];
    now = 1002;
    await tracker.poll();
    const firstObservedAt = tracker.list()[0]?.agent?.observedAt;
    expect(firstObservedAt).toBe(1002);

    // When: another poll observes the same agent.
    now = 1003;
    await tracker.poll();

    // Then: observedAt is held steady so the renderer does not re-render on no-op observations.
    expect(tracker.list()[0]?.agent?.observedAt).toBe(firstObservedAt);
  });

  it('updates the agent when the foreground command switches to a different known agent', async () => {
    // Given: `claude` is detected.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: 'claude',
        args: 'claude',
      },
    ];
    now = 1002;
    await tracker.poll();

    // When: the foreground process becomes `codex` (the user exited claude and started codex
    // without an intervening shell-prompt-start, which can happen when shell integration is off).
    rows = [
      shellRow(457),
      {
        pid: 457,
        ppid: 123,
        pgid: 457,
        tpgid: 457,
        command: 'codex',
        args: 'codex',
      },
    ];
    now = 1003;
    await tracker.poll();

    // Then: the agent slot updates to codex with a refreshed observedAt.
    expect(tracker.list()[0]?.agent).toEqual({
      known: 'codex',
      kind: 'codex',
      status: 'ready',
      source: 'command-line',
      observedAt: 1003,
    });
  });

  it('applies Evermore agent events atomically and normalizes complete to ready', () => {
    // Given: a known agent command is running under shell integration.
    tracker.register('pty-1', 123, '/tmp');
    now = 1002;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'claude',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    onChanged.mockClear();

    // When: the agent reports it is awaiting input.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'awaiting-input',
        message: 'Permission needed',
        event: 'permission_request',
      },
    });

    // Then: agent and attention are emitted together in one runtime snapshot.
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(tracker.list()[0]).toMatchObject({
      agent: {
        known: 'claude',
        kind: 'claude',
        status: 'awaiting-input',
        source: 'agent-protocol',
        observedAt: 1003,
        detail: {
          event: 'permission_request',
          message: 'Permission needed',
        },
      },
      attention: {
        kind: 'awaiting-input',
        source: 'agent-protocol',
        observedAt: 1003,
      },
      integration: {
        protocols: ['osc633', 'osc133', 'osc777', 'evermore'],
      },
    });

    // When: the agent reports completion.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'complete',
      },
    });

    // Then: the external complete status is stored internally as ready and attention is cleared.
    expect(tracker.list()[0]).toMatchObject({
      agent: {
        known: 'claude',
        kind: 'claude',
        status: 'ready',
        source: 'agent-protocol',
        observedAt: 1004,
      },
    });
    expect(tracker.list()[0]?.attention).toBeUndefined();
  });

  it('lets agent-protocol status outrank command-line detection until the next shell command starts', async () => {
    // Given: ps observes a known agent and an explicit protocol event marks it running.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: 'claude',
        args: 'claude',
      },
    ];
    now = 1002;
    await tracker.poll();
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      },
    });

    // When: another ps poll sees the same command-line agent.
    now = 1004;
    await tracker.poll();

    // Then: command-line detection does not downgrade the explicit running status to ready.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      kind: 'claude',
      status: 'running',
      source: 'agent-protocol',
      observedAt: 1003,
    });

    // When: the next local shell command starts.
    now = 1005;
    tracker.applySignal('pty-1', {
      type: 'shell-command-line',
      command: 'pnpm test',
      source: 'osc633',
    });
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });

    // Then: the protocol-owned agent state is cleared.
    expect(tracker.list()[0]?.agent).toBeUndefined();
  });

  it('returns awaiting-input agents to ready when user input is written', () => {
    // Given: an explicit awaiting-input event is active.
    tracker.register('pty-1', 123, '/tmp');
    now = 1002;
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'awaiting-input',
      },
    });

    // When: renderer-originated user input is observed.
    now = 1003;
    onChanged.mockClear();
    tracker.notifyUserInput('pty-1');

    // Then: attention clears and the agent falls back to ready because the approval result is not
    // observable through the PTY write path.
    expect(tracker.list()[0]?.attention).toBeUndefined();
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      status: 'ready',
      source: 'agent-protocol',
      observedAt: 1003,
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('does not change running or ready agent status when user input is written', () => {
    // Given: an explicit running event is active.
    tracker.register('pty-1', 123, '/tmp');
    now = 1002;
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      },
    });

    // When: renderer-originated user input is observed.
    now = 1003;
    onChanged.mockClear();
    tracker.notifyUserInput('pty-1');

    // Then: running state is preserved and no redundant runtime snapshot is emitted.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      status: 'running',
      source: 'agent-protocol',
      observedAt: 1002,
    });
    expect(onChanged).not.toHaveBeenCalled();

    // When: the agent reports completion and another user input is observed.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'complete',
      },
    });
    now = 1005;
    onChanged.mockClear();
    tracker.notifyUserInput('pty-1');

    // Then: ready state is also preserved without an emit.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      status: 'ready',
      source: 'agent-protocol',
      observedAt: 1004,
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('allows explicit agent events to overwrite the ready fallback after user input', () => {
    // Given: awaiting-input has fallen back to ready after user input.
    tracker.register('pty-1', 123, '/tmp');
    now = 1002;
    tracker.applySignal('pty-1', { type: 'shell-command-started', source: 'osc133' });
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'awaiting-input',
      },
    });
    now = 1003;
    tracker.notifyUserInput('pty-1');

    // When: the agent later reports that it is running.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      },
    });

    // Then: explicit protocol status still wins over the fallback.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      status: 'running',
      source: 'agent-protocol',
      observedAt: 1004,
    });

    // When: the agent reports completion.
    now = 1005;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'complete',
      },
    });

    // Then: complete still normalizes to ready.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      status: 'ready',
      source: 'agent-protocol',
      observedAt: 1005,
    });
  });

  it('updates agent observedAt on source/status changes but preserves it across redundant re-emits', async () => {
    // Given: a known agent is detected from the command line.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: 'claude',
        args: 'claude',
      },
    ];
    now = 1002;
    await tracker.poll();

    // Then: command-line detection seeds agent at the poll time.
    expect(tracker.list()[0]?.agent).toMatchObject({
      known: 'claude',
      kind: 'claude',
      status: 'ready',
      source: 'command-line',
      observedAt: 1002,
    });

    // When: an agent-protocol event arrives with the same known agent and the running status.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      },
    });

    // Then: the source / status change bumps observedAt to the event time.
    expect(tracker.list()[0]?.agent).toMatchObject({
      source: 'agent-protocol',
      status: 'running',
      observedAt: 1003,
    });

    // When: the same agent-protocol running status is re-emitted.
    now = 1004;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'running',
      },
    });

    // Then: observedAt is preserved because kind and status are unchanged.
    expect(tracker.list()[0]?.agent).toMatchObject({
      source: 'agent-protocol',
      status: 'running',
      observedAt: 1003,
    });
  });

  it('ignores remote Evermore agent events while ssh is the foreground session', async () => {
    // Given: ps classifies the local foreground session as ssh.
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    rows = [
      shellRow(456),
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/ssh',
        args: '/usr/bin/ssh host',
      },
    ];
    now = 1002;
    await tracker.poll();

    // When: a remote shell emits an Evermore agent event.
    now = 1003;
    tracker.applySignal('pty-1', {
      type: 'agent-event',
      source: 'evermore-osc777',
      event: {
        v: 1,
        type: 'agent-status',
        agent: 'claude',
        status: 'awaiting-input',
      },
    });

    // Then: local pane agent / attention state remains empty, while protocol observation is kept.
    const [info] = tracker.list();
    expect(info?.foregroundSession.kind).toBe('ssh');
    expect(info?.agent).toBeUndefined();
    expect(info?.attention).toBeUndefined();
    expect(info?.integration.protocols).toEqual(['osc777', 'evermore']);
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
    tracker.register('pty-1', 123, '/tmp');
    await vi.runOnlyPendingTimersAsync();
    listProcesses.mockClear();

    // When: polling is disabled.
    tracker.setPollIntervalMs(0);
    await vi.advanceTimersByTimeAsync(5000);

    // Then: no recurring polls run.
    expect(listProcesses).not.toHaveBeenCalled();
  });
});
