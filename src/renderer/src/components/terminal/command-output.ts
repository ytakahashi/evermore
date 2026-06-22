import type { IBuffer, IMarker } from '@xterm/xterm';

export interface TerminalBufferBoundary {
  /** Zero-based xterm buffer column captured with the marker. */
  column: number;
  /** Marker that tracks the boundary line through scrollback trim and reflow. */
  marker: IMarker;
}

export interface TerminalOutputRange {
  outputEnd: TerminalBufferBoundary;
  outputStart: TerminalBufferBoundary;
}

export interface TerminalOutputFingerprint {
  /** JavaScript string length of the normalized output. */
  length: number;
  /** Eight-character hexadecimal FNV-1a hash over normalized UTF-8 bytes. */
  hash: string;
}

export interface TerminalCommandCopySource extends TerminalOutputRange {
  command: string;
  outputFingerprint: TerminalOutputFingerprint;
}

/**
 * Reconstructs normalized plain text from an xterm normal-buffer range.
 *
 * Wrapped physical rows are joined without a newline. Unwrapped rows retain their real line
 * breaks. Returns `null` when markers or columns no longer describe a complete buffer range.
 */
export function extractNormalizedTerminalOutput(
  buffer: IBuffer,
  range: TerminalOutputRange,
): string | null {
  const startLine = range.outputStart.marker.line;
  const endLine = range.outputEnd.marker.line;
  const startColumn = range.outputStart.column;
  const endColumn = range.outputEnd.column;

  if (
    buffer.type !== 'normal' ||
    range.outputStart.marker.isDisposed ||
    range.outputEnd.marker.isDisposed ||
    !isBufferPositionValid(buffer, startLine, startColumn) ||
    !isBufferPositionValid(buffer, endLine, endColumn) ||
    endLine < startLine ||
    (endLine === startLine && endColumn < startColumn)
  ) {
    return null;
  }

  let output = '';
  for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    if (!line) {
      return null;
    }

    if (lineIndex > startLine && !line.isWrapped) {
      output += '\n';
    }

    const fromColumn = lineIndex === startLine ? startColumn : 0;
    const toColumn = lineIndex === endLine ? endColumn : undefined;
    // Preserve physical-row trailing spaces until wrapped rows have been joined. A space in the
    // final cell before a soft wrap is internal logical-line content, not line-end padding.
    output += line.translateToString(false, fromColumn, toColumn);
  }

  return normalizeTerminalOutput(output);
}

/**
 * Creates compact metadata used to detect buffer mutation without retaining the output itself.
 */
export function createTerminalOutputFingerprint(output: string): TerminalOutputFingerprint {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(output)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return {
    length: output.length,
    hash: (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

/**
 * Builds clipboard text only when the current xterm range matches its completion fingerprint.
 */
export function createTerminalCommandCopyText(
  buffer: IBuffer,
  source: TerminalCommandCopySource,
): string | null {
  const output = extractNormalizedTerminalOutput(buffer, source);
  if (output === null) {
    return null;
  }

  if (!fingerprintsMatch(createTerminalOutputFingerprint(output), source.outputFingerprint)) {
    return null;
  }

  return output.length === 0 ? `$ ${source.command}` : `$ ${source.command}\n${output}`;
}

function isBufferPositionValid(buffer: IBuffer, lineIndex: number, column: number): boolean {
  if (
    !Number.isInteger(lineIndex) ||
    !Number.isInteger(column) ||
    lineIndex < 0 ||
    lineIndex >= buffer.length ||
    column < 0
  ) {
    return false;
  }

  const line = buffer.getLine(lineIndex);
  return line !== undefined && column <= line.length;
}

function normalizeTerminalOutput(output: string): string {
  return output.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
}

function fingerprintsMatch(
  current: TerminalOutputFingerprint,
  expected: TerminalOutputFingerprint,
): boolean {
  return current.length === expected.length && current.hash === expected.hash;
}
