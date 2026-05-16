import { describe, expect, it } from 'vitest';
import { observePaneActivity, parseProcessTable } from './process-inspector';

describe('process-inspector', () => {
  it('parses process table rows from ps output', () => {
    // Given: macOS ps output without headers.
    const output = [
      '123 1 123 123 /bin/zsh /bin/zsh -l',
      '456 123 456 456 /usr/bin/python3 python3 -m http.server 3000',
    ].join('\n');

    // When: the process table is parsed.
    const rows = parseProcessTable(output);

    // Then: fixed columns and command args are separated.
    expect(rows).toEqual([
      {
        pid: 123,
        ppid: 1,
        pgid: 123,
        tpgid: 123,
        command: '/bin/zsh',
        args: '/bin/zsh -l',
      },
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/bin/python3',
        args: 'python3 -m http.server 3000',
      },
    ]);
  });

  it('reports idle when the foreground process group is the shell group', () => {
    // Given: the shell owns the foreground process group.
    const rows = [
      {
        pid: 123,
        ppid: 1,
        pgid: 123,
        tpgid: 123,
        command: '/bin/zsh',
        args: '/bin/zsh -l',
      },
    ];

    // When: pane activity is observed.
    const activity = observePaneActivity(rows, 123);

    // Then: the pane is considered idle.
    expect(activity).toEqual({ activity: 'idle' });
  });

  it('reports the foreground command when another process group is active', () => {
    // Given: a child process group is in the foreground.
    const rows = [
      {
        pid: 123,
        ppid: 1,
        pgid: 123,
        tpgid: 456,
        command: '/bin/zsh',
        args: '/bin/zsh -l',
      },
      {
        pid: 456,
        ppid: 123,
        pgid: 456,
        tpgid: 456,
        command: '/usr/local/bin/node',
        args: 'node /Users/tester/project/server.js',
      },
    ];

    // When: pane activity is observed.
    const activity = observePaneActivity(rows, 123);

    // Then: the foreground process is surfaced as running.
    expect(activity).toEqual({
      activity: 'running',
      foregroundCommand: 'node /Users/tester/project/server.js',
      foregroundArgs: 'node /Users/tester/project/server.js',
    });
  });
});
