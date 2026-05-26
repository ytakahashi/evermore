import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeSignal } from '../../shared/pane-runtime-signal';
import { encodeOsc633CommandLine } from '../../shared/shell-integration/osc633-encode';
import { TerminalSignalParser } from './terminal-signal-parser';

function collectSignals(chunks: string[], maxOscPayloadCodeUnits?: number): PaneRuntimeSignal[] {
  const signals: PaneRuntimeSignal[] = [];
  const parser = new TerminalSignalParser({
    maxOscPayloadCodeUnits,
    emit: (signal) => {
      signals.push(signal);
    },
  });

  for (const chunk of chunks) {
    parser.applyChunk(chunk);
  }

  return signals;
}

function decodeEscapedFixture(fixture: string): string {
  let decoded = '';

  for (let index = 0; index < fixture.length; index += 1) {
    const char = fixture[index];
    if (char !== '\\') {
      decoded += char;
      continue;
    }

    const next = fixture[index + 1];
    if (next === '\\') {
      decoded += '\\';
      index += 1;
      continue;
    }

    if (next === 'x') {
      const hex = fixture.slice(index + 2, index + 4);
      if (hex.toLowerCase() === '1b' || hex.toLowerCase() === '07') {
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 3;
        continue;
      }
    }

    decoded += char;
  }

  return decoded;
}

describe('TerminalSignalParser', () => {
  it('emits OSC 133 lifecycle signals terminated by BEL', () => {
    // Given: FinalTerm/iTerm2-style lifecycle OSC sequences.
    const data = [
      '\x1b]133;A\x07',
      '\x1b]133;B\x07',
      '\x1b]133;C\x07',
      '\x1b]133;D\x07',
      '\x1b]133;D;0\x07',
      '\x1b]133;D;130\x07',
      '\x1b]133;A;aid=foo\x07',
    ];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: each lifecycle marker is converted into the shared signal shape.
    expect(signals).toEqual([
      { type: 'shell-prompt-start', source: 'osc133' },
      { type: 'shell-prompt-end', source: 'osc133' },
      { type: 'shell-command-started', source: 'osc133' },
      { type: 'shell-command-finished', source: 'osc133' },
      { type: 'shell-command-finished', source: 'osc133', exitCode: 0 },
      { type: 'shell-command-finished', source: 'osc133', exitCode: 130 },
      { type: 'shell-prompt-start', source: 'osc133' },
    ]);
  });

  it('emits OSC 633 lifecycle signals as the same lifecycle signal types', () => {
    // Given: VS Code-style lifecycle OSC sequences plus unsupported 633 variants.
    const data = [
      '\x1b]633;A\x07',
      '\x1b]633;B\x07',
      '\x1b]633;C\x07',
      '\x1b]633;D;0\x07',
      '\x1b]633;P;Cwd=/Users/me\x07',
      '\x1b]633;F\x07',
    ];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: A/B/C/D are mapped while unsupported 633 subcommands are ignored.
    expect(signals).toEqual([
      { type: 'shell-prompt-start', source: 'osc633' },
      { type: 'shell-prompt-end', source: 'osc633' },
      { type: 'shell-command-started', source: 'osc633' },
      { type: 'shell-command-finished', source: 'osc633', exitCode: 0 },
    ]);
  });

  it('keeps duplicate 133 and 633 lifecycle signals for the tracker to debounce later', () => {
    // Given: a shell setup emits the same lifecycle marker in both namespaces.
    const data = '\x1b]133;A\x07\x1b]633;A\x07';

    // When: the PTY output is parsed.
    const signals = collectSignals([data]);

    // Then: the parser stays a dumb tap and emits both observations.
    expect(signals).toEqual([
      { type: 'shell-prompt-start', source: 'osc133' },
      { type: 'shell-prompt-start', source: 'osc633' },
    ]);
  });

  it('supports ST terminators and chunk boundaries', () => {
    // Given: OSC sequences split at arbitrary PTY chunk boundaries.
    const chunks = ['\x1b]133;', 'C\x1b', '\\', '\x1b', ']133;B\x07'];

    // When: the chunks are parsed incrementally.
    const signals = collectSignals(chunks);

    // Then: split BEL/ST-terminated sequences are reconstructed.
    expect(signals).toEqual([
      { type: 'shell-command-started', source: 'osc133' },
      { type: 'shell-prompt-end', source: 'osc133' },
    ]);
  });

  it('parses OSC 7 cwd payloads', () => {
    // Given: terminal cwd reports in file URL and absolute path forms.
    const data = [
      '\x1b]7;file://host/Users/me\x07',
      '\x1b]7;file:///Users/me/foo%20bar\x07',
      '\x1b]7;/Users/me/plain%20path\x07',
      '\x1b]7;file:///foo%ZZ\x07',
      '\x1b]7;foo/bar\x07',
    ];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: only absolute, decodable cwd payloads are emitted.
    expect(signals).toEqual([
      { type: 'cwd', cwd: '/Users/me', source: 'osc7' },
      { type: 'cwd', cwd: '/Users/me/foo bar', source: 'osc7' },
      { type: 'cwd', cwd: '/Users/me/plain path', source: 'osc7' },
    ]);
  });

  it('decodes OSC 633 command lines using VS Code escaping', () => {
    // Given: command line payloads containing escaped semicolons, backslashes, and newlines.
    const data = [
      '\x1b]633;E;ls\x07',
      '\x1b]633;E;echo a\\x3bb\x07',
      '\x1b]633;E;path\\\\to\x07',
      '\x1b]633;E;line1\\x0aline2\x07',
      '\x1b]633;E;ls;deadbeef\x07',
    ];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: encoded command lines are restored and optional nonces are ignored.
    expect(signals).toEqual([
      { type: 'shell-command-line', command: 'ls', source: 'osc633' },
      { type: 'shell-command-line', command: 'echo a;b', source: 'osc633' },
      { type: 'shell-command-line', command: 'path\\to', source: 'osc633' },
      { type: 'shell-command-line', command: 'line1\nline2', source: 'osc633' },
      { type: 'shell-command-line', command: 'ls', source: 'osc633' },
    ]);
  });

  it('round-trips OSC 633 command lines encoded as UTF-8 bytes', () => {
    // Given: commands that exercise separators, control bytes, backslashes, and multibyte text.
    const commands = [
      'pnpm run dev; ls',
      "printf 'a\\b'",
      'cat <<EOF\n日本語\nEOF',
      'line1\r\0line2',
    ];
    const data = commands.map((command) => {
      return `\x1b]633;E;${encodeOsc633CommandLine(command)}\x07`;
    });

    // When: the encoded payloads are parsed.
    const signals = collectSignals(data);

    // Then: each command line is restored exactly.
    expect(signals).toEqual(
      commands.map((command) => ({
        type: 'shell-command-line',
        command,
        source: 'osc633',
      })),
    );
  });

  it('drops malformed or empty OSC 633 command line payloads', () => {
    // Given: invalid command line escape sequences and an empty command payload.
    const data = [
      '\x1b]633;E;\\q\x07',
      '\x1b]633;E;\\x0G\x07',
      '\x1b]633;E;\\xe6\\x97\x07',
      '\x1b]633;E;\x07',
    ];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: no command line signals are emitted.
    expect(signals).toEqual([]);
  });

  it('emits Evermore OSC 777 agent events with normalized agent names', () => {
    // Given: Evermore namespaced OSC 777 payloads from an agent hook.
    const payload = JSON.stringify({
      v: 1,
      type: 'agent-status',
      agent: ' Claude ',
      status: 'awaiting-input',
      message: 'Permission needed',
      event: 'permission_request',
      cwd: '/Users/tester/project',
      toolName: 'write_file',
      toolInput: { file_path: 'src/main.ts' },
      extra: 'allowed',
    });

    // When: the terminal output is parsed.
    const signals = collectSignals([`\x1b]777;evermore;${payload}\x07`]);

    // Then: the payload is validated and emitted without affecting raw terminal output handling.
    expect(signals).toEqual([
      {
        type: 'agent-event',
        source: 'evermore-osc777',
        event: {
          v: 1,
          type: 'agent-status',
          agent: 'claude',
          status: 'awaiting-input',
          message: 'Permission needed',
          event: 'permission_request',
          cwd: '/Users/tester/project',
          toolName: 'write_file',
          toolInput: { file_path: 'src/main.ts' },
        },
      },
    ]);
  });

  it('drops invalid Evermore OSC 777 agent event payloads', () => {
    // Given: unsupported or malformed agent-event payloads plus an unrelated OSC 777 notify.
    const invalidPayloads = [
      '{"v":1,"type":"agent-status","agent":"claude","status":"running"',
      JSON.stringify({ v: 2, type: 'agent-status', agent: 'claude', status: 'running' }),
      JSON.stringify({ v: 1, type: 'notify', agent: 'claude', status: 'running' }),
      JSON.stringify({ v: 1, type: 'agent-status', agent: '   ', status: 'running' }),
      JSON.stringify({ v: 1, type: 'agent-status', agent: 'claude', status: 'thinking' }),
    ];
    const data = [
      ...invalidPayloads.map((payload) => `\x1b]777;evermore;${payload}\x07`),
      '\x1b]777;notify;Title;Body\x07',
    ];

    // When: the terminal output is parsed.
    const signals = collectSignals(data);

    // Then: no agent-event signal is emitted for invalid or unsupported variants.
    expect(signals).toEqual([]);
  });

  it('drops oversized Evermore OSC 777 agent event payloads before JSON parsing', () => {
    // Given: a syntactically valid payload that exceeds the agent-event byte limit.
    const payload = JSON.stringify({
      v: 1,
      type: 'agent-status',
      agent: 'claude',
      status: 'running',
      message: 'x'.repeat(8200),
    });

    // When: the payload is parsed.
    const signals = collectSignals([`\x1b]777;evermore;${payload}\x07`]);

    // Then: it is dropped as a whole.
    expect(signals).toEqual([]);
  });

  it('reports a reason via onDropAgentEvent for every OSC 777 drop case', () => {
    // Given: a parser whose code-unit guard is wide enough to let the OSC 777 byte guard fire,
    // configured with an onDropAgentEvent observer.
    const reasons: string[] = [];
    const parser = new TerminalSignalParser({
      maxOscPayloadCodeUnits: 65_536,
      emit: () => {},
      onDropAgentEvent: (reason) => {
        reasons.push(reason);
      },
    });
    const oversizedPayload = JSON.stringify({
      v: 1,
      type: 'agent-status',
      agent: 'claude',
      status: 'running',
      message: 'x'.repeat(8200),
    });
    const cases: Array<[string, string]> = [
      [`\x1b]777;evermore;${oversizedPayload}\x07`, 'oversized payload'],
      ['\x1b]777;evermore;{not-json\x07', 'malformed JSON'],
      ['\x1b]777;evermore;[1,2,3]\x07', 'payload is not an object'],
      [
        `\x1b]777;evermore;${JSON.stringify({ v: 2, type: 'agent-status', agent: 'claude', status: 'running' })}\x07`,
        'unsupported version',
      ],
      [
        `\x1b]777;evermore;${JSON.stringify({ v: 1, type: 'notify', agent: 'claude', status: 'running' })}\x07`,
        'unsupported event type',
      ],
      [
        `\x1b]777;evermore;${JSON.stringify({ v: 1, type: 'agent-status', agent: '   ', status: 'running' })}\x07`,
        'missing agent',
      ],
      [
        `\x1b]777;evermore;${JSON.stringify({ v: 1, type: 'agent-status', agent: 'claude', status: 'thinking' })}\x07`,
        'unsupported status',
      ],
    ];

    // When: each invalid payload is streamed through the parser.
    for (const [chunk] of cases) {
      parser.applyChunk(chunk);
    }

    // Then: every drop reason is reported in order via the observer callback.
    expect(reasons).toEqual(cases.map(([, reason]) => reason));
  });

  it('discards oversized OSC payloads until their terminator and resumes afterward', () => {
    // Given: an oversized OSC payload that contains a nested OSC-looking sequence before BEL.
    const data = [`\x1b]633;E;${'a'.repeat(20)}\x1b]133;A\x07`, '\x1b]133;C\x07'];

    // When: the payload exceeds the configured limit.
    const signals = collectSignals(data, 16);

    // Then: the oversized payload is ignored and later OSC sequences still parse normally.
    expect(signals).toEqual([{ type: 'shell-command-started', source: 'osc133' }]);
  });

  it('ignores unknown OSC and non-OSC escape sequences', () => {
    // Given: terminal output includes unsupported OSC, CSI, and DCS sequences.
    const data = ['\x1b]9;notify\x07', '\x1b[31mred\x1b[0m', '\x1bP1;2qsome\x1b\\'];

    // When: the PTY output is parsed.
    const signals = collectSignals(data);

    // Then: unsupported sequences do not emit runtime signals.
    expect(signals).toEqual([]);
  });

  it('skips high-throughput chunks that cannot contain OSC sequences', () => {
    // Given: a large chunk without any ESC byte.
    const emit = vi.fn<(signal: PaneRuntimeSignal) => void>();
    const parser = new TerminalSignalParser({ emit });

    // When: the parser observes the chunk.
    parser.applyChunk('x'.repeat(1024 * 1024));

    // Then: no signals are emitted.
    expect(emit).not.toHaveBeenCalled();
  });

  it('clears incomplete payloads on dispose', () => {
    // Given: a parser has retained an incomplete OSC payload.
    const signals: PaneRuntimeSignal[] = [];
    const parser = new TerminalSignalParser({
      emit: (signal) => {
        signals.push(signal);
      },
    });
    parser.applyChunk('\x1b]133;');

    // When: the parser is disposed before the terminator arrives, then reused.
    parser.dispose();
    parser.applyChunk('C\x07');
    parser.applyChunk('\x1b]133;B\x07');

    // Then: the stale partial payload is gone and subsequent complete OSC still works.
    expect(signals).toEqual([{ type: 'shell-prompt-end', source: 'osc133' }]);
  });

  it('does not throw when the onDropAgentEvent callback throws', () => {
    // Given: a parser whose drop observer throws on every invocation.
    const parser = new TerminalSignalParser({
      emit: () => {},
      onDropAgentEvent: () => {
        throw new Error('drop observer failed');
      },
    });

    // When / Then: malformed OSC 777 input must not propagate out of applyChunk, otherwise raw
    // PTY data forwarding would stall whenever a bad payload arrives.
    expect(() => {
      parser.applyChunk('\x1b]777;evermore;not-json\x07');
    }).not.toThrow();
  });

  it('does not throw when the signal callback throws', () => {
    // Given: a signal callback with a bug.
    const parser = new TerminalSignalParser({
      emit: () => {
        throw new Error('callback failed');
      },
    });

    // When / Then: parser observation failures are contained.
    expect(() => {
      parser.applyChunk('\x1b]133;C\x07');
    }).not.toThrow();
  });

  it('parses a VS Code-compatible OSC fixture as a golden signal sequence', () => {
    // Given: a captured-style fixture with VS Code 633 lifecycle, command line, property, and cwd.
    const fixture = readFileSync(
      join(process.cwd(), 'src/main/pty/__fixtures__/vscode-osc.txt'),
      'utf8',
    );
    const data = decodeEscapedFixture(fixture);

    // When: the fixture is streamed through the parser.
    const signals = collectSignals([data]);

    // Then: supported VS Code signals are emitted in order and unsupported properties are dropped.
    expect(signals).toEqual([
      { type: 'shell-prompt-start', source: 'osc633' },
      { type: 'cwd', cwd: '/Users/me/project', source: 'osc7' },
      { type: 'shell-prompt-end', source: 'osc633' },
      {
        type: 'shell-command-line',
        command: "echo hello; printf 'done\\n'",
        source: 'osc633',
      },
      { type: 'shell-command-started', source: 'osc633' },
      { type: 'shell-command-finished', source: 'osc633', exitCode: 0 },
    ]);
  });
});
