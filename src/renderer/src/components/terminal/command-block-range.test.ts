import type { IMarker } from '@xterm/xterm';
import { describe, expect, it } from 'vite-plus/test';
import { getTerminalCommandBlockRange } from './command-block-range';

describe('getTerminalCommandBlockRange', () => {
  it.each([
    { start: 2, end: 5, column: 0, disposed: false, expected: { start: 2, end: 4 } },
    { start: 2, end: 5, column: 3, disposed: false, expected: { start: 2, end: 5 } },
    { start: 2, end: 2, column: 0, disposed: false, expected: { start: 2, end: 2 } },
    { start: -1, end: 5, column: 0, disposed: false, expected: null },
    { start: 5, end: 2, column: 0, disposed: false, expected: null },
    { start: 2, end: 10, column: 0, disposed: false, expected: null },
    { start: 2, end: 5, column: 0, disposed: true, expected: null },
  ])(
    'resolves physical rows without including the next prompt: %j',
    ({ start, end, column, disposed, expected }) => {
      // Given: physical markers describe a block in a retained buffer.
      const block = {
        blockStartMarker: { line: start, isDisposed: false } as IMarker,
        outputEnd: { marker: { line: end, isDisposed: disposed } as IMarker, column },
      };

      // When: the display range is requested.
      const range = getTerminalCommandBlockRange(block, 10);

      // Then: exclusive boundaries and invalid ranges have a single interpretation for every display.
      expect(range).toEqual(expected);
    },
  );
});
