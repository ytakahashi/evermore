import type { IMarker } from '@xterm/xterm';
import type { TerminalBufferBoundary } from './command-output';

/** Resolves inclusive physical rows while preserving the exclusive OSC completion boundary. */
export function getTerminalCommandBlockRange(
  block: { blockStartMarker: IMarker; outputEnd: TerminalBufferBoundary },
  bufferLength: number,
): { start: number; end: number } | null {
  const start = block.blockStartMarker.line;
  const boundary = block.outputEnd.marker.line;
  if (
    block.blockStartMarker.isDisposed ||
    block.outputEnd.marker.isDisposed ||
    start < 0 ||
    boundary < start ||
    boundary >= bufferLength
  ) {
    return null;
  }
  // D at column zero belongs to the following prompt. Empty blocks still contain their first row.
  return { start, end: Math.max(start, boundary - (block.outputEnd.column === 0 ? 1 : 0)) };
}
