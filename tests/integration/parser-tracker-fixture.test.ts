/**
 * Integration test: pipes a real `TerminalSignalParser` (from `src/main/pty/`) into a real
 * `PaneInfoTracker` (from `src/main/pane-info/`) and verifies that the cross-module wiring
 * surfaces a coherent `PaneRuntimeInfo` snapshot for a VS Code-style OSC capture.
 *
 * Lives in `tests/integration/` rather than colocated with either module's unit tests because
 * neither side is the sole subject under test — the seam between parser-emitted signals and
 * tracker state mutation is what is being asserted. Determinism is preserved: the fixture is a
 * checked-in static blob and no external process is spawned.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { PaneInfoTracker } from '../../src/main/pane-info/pane-info-tracker';
import type { PaneInfoChangedEvent } from '../../src/main/pane-info/types';
import { TerminalSignalParser } from '../../src/main/pty/terminal-signal-parser';

/**
 * Decodes only the terminal control bytes `\x1b` (ESC) and `\x07` (BEL) used to delimit OSC
 * sequences in the fixture, leaving inner OSC 633;E `\xNN` escapes (`\x3b`, `\x27`, `\x5c`)
 * intact so the parser's command-line decoder sees the on-the-wire shape produced by VS Code.
 */
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

describe('TerminalSignalParser → PaneInfoTracker integration', () => {
  it('reflects a VS Code-compatible OSC fixture end-to-end from parser through tracker emission', async () => {
    // Given: a tracker pipes a TerminalSignalParser into its applySignal entry point.
    const onChanged = vi.fn<(event: PaneInfoChangedEvent) => void>();
    const tracker = new PaneInfoTracker({
      callbacks: { onChanged },
      // ps polling would race with the deterministic fixture replay below; stub it out so the
      // tracker only reacts to OSC signals emitted by the parser.
      inspector: { listProcesses: () => Promise.resolve([]) },
      now: () => 1002,
      pollIntervalMs: 0,
    });
    tracker.register('pty-1', 123, '/tmp');
    await new Promise((resolve) => setTimeout(resolve, 0));
    onChanged.mockClear();

    const parser = new TerminalSignalParser({
      emit: (signal) => {
        tracker.applySignal('pty-1', signal);
      },
    });
    const fixture = readFileSync(
      join(process.cwd(), 'src/main/pty/__fixtures__/vscode-osc.txt'),
      'utf8',
    );

    // When: the VS Code shell integration fixture is streamed through the parser.
    parser.applyChunk(decodeEscapedFixture(fixture));

    // Then: the tracker reflects cwd, integration protocols, the in-flight command lifecycle,
    // and the finished command with its exit code as a single coherent runtime snapshot.
    const [info] = tracker.list();
    expect(info?.cwd).toBe('/Users/me/project');
    expect(info?.integration.shell).toBe(true);
    expect(info?.integration.protocols).toEqual(['osc633', 'osc7']);
    expect(info?.command).toEqual({
      line: "echo hello; printf 'done\\n'",
      startedAt: 1002,
      finishedAt: 1002,
      exitCode: 0,
      source: 'shell-integration',
    });
    expect(onChanged).toHaveBeenCalled();
  });
});
