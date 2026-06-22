import type { IBuffer, IBufferLine, IMarker } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import {
  createTerminalCommandCopyText,
  createTerminalOutputFingerprint,
  extractNormalizedTerminalOutput,
  type TerminalBufferBoundary,
  type TerminalCommandCopySource,
} from './command-output';

interface LineDefinition {
  isWrapped?: boolean;
  text: string;
}

class MockMarker implements IMarker {
  public readonly id: number;
  public line: number;
  public isDisposed = false;
  public readonly onDispose = (): { dispose: () => void } => ({ dispose: () => undefined });

  public constructor(id: number, line: number) {
    this.id = id;
    this.line = line;
  }

  public dispose(): void {
    this.isDisposed = true;
    this.line = -1;
  }
}

function createLine(definition: LineDefinition): IBufferLine {
  return {
    isWrapped: definition.isWrapped ?? false,
    length: definition.text.length,
    getCell: () => undefined,
    translateToString: (
      trimRight = false,
      startColumn = 0,
      endColumn = definition.text.length,
    ): string => {
      const text = definition.text.slice(startColumn, endColumn);
      return trimRight ? text.replace(/\s+$/, '') : text;
    },
  };
}

function createBuffer(lines: LineDefinition[], type: 'alternate' | 'normal' = 'normal'): IBuffer {
  const bufferLines = lines.map(createLine);
  return {
    type,
    cursorX: 0,
    cursorY: 0,
    viewportY: 0,
    baseY: 0,
    length: bufferLines.length,
    getLine: (index) => bufferLines[index],
    getNullCell: () => {
      throw new Error('getNullCell is not used by command-output');
    },
  };
}

function boundary(line: number, column: number, id = line + 1): TerminalBufferBoundary {
  return {
    column,
    marker: new MockMarker(id, line),
  };
}

function copySource(
  command: string,
  output: string,
  outputStart: TerminalBufferBoundary,
  outputEnd: TerminalBufferBoundary,
): TerminalCommandCopySource {
  return {
    command,
    outputStart,
    outputEnd,
    outputFingerprint: createTerminalOutputFingerprint(output),
  };
}

describe('extractNormalizedTerminalOutput', () => {
  it('extracts one line and excludes content after the end column', () => {
    // Given: command output and a following prompt share one physical line.
    const buffer = createBuffer([{ text: 'resultnext-prompt' }]);

    // When: only the output columns are extracted.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(0, 6),
    });

    // Then: the following prompt is excluded.
    expect(output).toBe('result');
  });

  it('keeps real newlines while joining soft-wrapped physical rows', () => {
    // Given: one logical line wraps, followed by a real newline and another line.
    const buffer = createBuffer([
      { text: 'abcdefgh' },
      { text: 'ijkl', isWrapped: true },
      { text: 'second' },
      { text: '' },
    ]);

    // When: the complete output range is reconstructed.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(3, 0),
    });

    // Then: only the real line break remains.
    expect(output).toBe('abcdefghijkl\nsecond');
  });

  it('preserves spaces at a physical-row boundary inside a soft-wrapped logical line', () => {
    // Given: a wrapped physical row ends with meaningful alignment spaces.
    const buffer = createBuffer([
      { text: 'a       ' },
      { text: 'bcd', isWrapped: true },
      { text: '' },
    ]);

    // When: the wrapped rows are reconstructed and then normalized.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(2, 0),
    });

    // Then: internal spaces survive because only logical line endings are trimmed.
    expect(output).toBe('a       bcd');
  });

  it('preserves internal blank lines and removes trailing whitespace and empty lines', () => {
    // Given: output contains indentation, blank lines, and trailing whitespace.
    const buffer = createBuffer([
      { text: '  first   ' },
      { text: '' },
      { text: ' second\t' },
      { text: '   ' },
      { text: '' },
    ]);

    // When: the output is normalized.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(4, 0),
    });

    // Then: leading indentation and internal blank lines remain, but trailing space is removed.
    expect(output).toBe('  first\n\n second');
  });

  it('returns the final visible carriage-return content represented in the buffer', () => {
    // Given: xterm has already reduced repeated carriage-return updates to the final display.
    const buffer = createBuffer([{ text: 'progress 100%' }, { text: '' }]);

    // When: the visible output range is extracted.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(1, 0),
    });

    // Then: only the final display is returned.
    expect(output).toBe('progress 100%');
  });

  it('preserves CJK and emoji text supplied by xterm line translation', () => {
    // Given: a translated xterm line contains wide and combined characters.
    const buffer = createBuffer([{ text: '日本語🙂ABC' }, { text: '' }]);

    // When: the range is extracted without slicing through the wide characters.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(1, 0),
    });

    // Then: the translated Unicode text remains unchanged.
    expect(output).toBe('日本語🙂ABC');
  });

  it('returns an empty string for a command with no output', () => {
    // Given: start and end point to the same buffer position.
    const buffer = createBuffer([{ text: 'prompt' }]);

    // When: the zero-length range is extracted.
    const output = extractNormalizedTerminalOutput(buffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(0, 0),
    });

    // Then: empty output is a valid result, distinct from an invalid range.
    expect(output).toBe('');
  });

  it.each([
    {
      name: 'disposed start marker',
      arrange: (): {
        buffer: IBuffer;
        outputStart: TerminalBufferBoundary;
        outputEnd: TerminalBufferBoundary;
      } => {
        const outputStart = boundary(0, 0);
        outputStart.marker.dispose();
        return {
          buffer: createBuffer([{ text: 'output' }]),
          outputStart,
          outputEnd: boundary(0, 6),
        };
      },
    },
    {
      name: 'disposed end marker',
      arrange: (): {
        buffer: IBuffer;
        outputStart: TerminalBufferBoundary;
        outputEnd: TerminalBufferBoundary;
      } => {
        const outputEnd = boundary(0, 6);
        outputEnd.marker.dispose();
        return {
          buffer: createBuffer([{ text: 'output' }]),
          outputStart: boundary(0, 0),
          outputEnd,
        };
      },
    },
    {
      name: 'line outside the buffer',
      arrange: () => ({
        buffer: createBuffer([{ text: 'output' }]),
        outputStart: boundary(0, 0),
        outputEnd: boundary(2, 0),
      }),
    },
    {
      name: 'column outside the line',
      arrange: () => ({
        buffer: createBuffer([{ text: 'short' }]),
        outputStart: boundary(0, 0),
        outputEnd: boundary(0, 10),
      }),
    },
    {
      name: 'reversed range',
      arrange: () => ({
        buffer: createBuffer([{ text: 'output' }]),
        outputStart: boundary(0, 5),
        outputEnd: boundary(0, 2),
      }),
    },
    {
      name: 'alternate buffer',
      arrange: () => ({
        buffer: createBuffer([{ text: 'output' }], 'alternate'),
        outputStart: boundary(0, 0),
        outputEnd: boundary(0, 6),
      }),
    },
  ])('rejects an invalid range with $name', ({ arrange }) => {
    // Given: an incomplete or invalid xterm range.
    const { buffer, outputStart, outputEnd } = arrange();

    // When: extraction is attempted.
    const output = extractNormalizedTerminalOutput(buffer, { outputStart, outputEnd });

    // Then: partial output is never returned.
    expect(output).toBeNull();
  });

  it('produces the same logical output after a simulated reflow', () => {
    // Given: wide and narrow xterm layouts for the same logical output.
    const wideBuffer = createBuffer([{ text: 'abcdefghijkl' }, { text: 'second' }, { text: '' }]);
    const narrowBuffer = createBuffer([
      { text: 'abcdef' },
      { text: 'ghijkl', isWrapped: true },
      { text: 'second' },
      { text: '' },
    ]);

    // When: each layout is extracted using its reflowed marker positions.
    const wideOutput = extractNormalizedTerminalOutput(wideBuffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(2, 0),
    });
    const narrowOutput = extractNormalizedTerminalOutput(narrowBuffer, {
      outputStart: boundary(0, 0),
      outputEnd: boundary(3, 0),
    });

    // Then: physical wrapping does not affect the normalized text.
    expect(wideOutput).toBe('abcdefghijkl\nsecond');
    expect(narrowOutput).toBe(wideOutput);
  });
});

describe('createTerminalOutputFingerprint', () => {
  it('is deterministic and distinguishes Unicode output changes', () => {
    // Given: equal and different normalized output strings.

    // When: compact fingerprints are created.
    const first = createTerminalOutputFingerprint('日本語🙂');
    const same = createTerminalOutputFingerprint('日本語🙂');
    const different = createTerminalOutputFingerprint('日本語');

    // Then: equal output matches while a Unicode change affects length or hash.
    expect(first).toEqual(same);
    expect(first).not.toEqual(different);
    expect(first.hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('createTerminalCommandCopyText', () => {
  it('formats a command with output and no trailing newline', () => {
    // Given: the current normalized output matches the completion fingerprint.
    const buffer = createBuffer([{ text: 'one' }, { text: 'two' }, { text: '' }]);
    const source = copySource('printf "one\\ntwo\\n"', 'one\ntwo', boundary(0, 0), boundary(2, 0));

    // When: clipboard text is generated.
    const text = createTerminalCommandCopyText(buffer, source);

    // Then: the fixed prompt prefix and output are joined without a final newline.
    expect(text).toBe('$ printf "one\\ntwo\\n"\none\ntwo');
  });

  it('preserves actual multiline command input and continuation backslashes', () => {
    // Given: OSC 633 supplied a command containing an actual newline and continuation backslash.
    const buffer = createBuffer([{ text: 'foo bar' }, { text: '' }]);
    const source = copySource('echo foo \\\nbar', 'foo bar', boundary(0, 0), boundary(1, 0));

    // When: clipboard text is generated.
    const text = createTerminalCommandCopyText(buffer, source);

    // Then: only the first command line receives the fixed prompt prefix.
    expect(text).toBe('$ echo foo \\\nbar\nfoo bar');
  });

  it('formats a command with empty output without adding a blank line', () => {
    // Given: a completed command has a valid empty-output fingerprint.
    const buffer = createBuffer([{ text: 'prompt' }]);
    const source = copySource('mkdir tmp', '', boundary(0, 0), boundary(0, 0));

    // When: clipboard text is generated.
    const text = createTerminalCommandCopyText(buffer, source);

    // Then: only the command is returned.
    expect(text).toBe('$ mkdir tmp');
  });

  it('rejects output changed after completion', () => {
    // Given: the fingerprint was captured for content that clear or redraw later changed.
    const buffer = createBuffer([{ text: 'changed' }, { text: '' }]);
    const source = copySource('echo original', 'original', boundary(0, 0), boundary(1, 0));

    // When: clipboard text is requested from the mutated range.
    const text = createTerminalCommandCopyText(buffer, source);

    // Then: stale or partial output is not copied.
    expect(text).toBeNull();
  });
});
