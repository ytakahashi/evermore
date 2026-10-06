import { describe, expect, it } from 'vite-plus/test';
import { findAdjacentCommand } from './command-navigation';

describe('findAdjacentCommand', () => {
  it.each([
    { anchor: 20, direction: 'previous' as const, expected: 'first' },
    { anchor: 20, direction: 'next' as const, expected: 'last' },
    { anchor: 15, direction: 'previous' as const, expected: 'first' },
    { anchor: 15, direction: 'next' as const, expected: 'middle' },
    { anchor: 10, direction: 'previous' as const, expected: null },
    { anchor: 30, direction: 'next' as const, expected: null },
    { anchor: 40, direction: 'previous' as const, expected: 'last' },
    { anchor: 0, direction: 'next' as const, expected: 'first' },
  ])('finds $direction from line $anchor', ({ anchor, direction, expected }) => {
    // Given: an immutable, unordered list with duplicate start lines.
    const entries = Object.freeze([
      Object.freeze({ id: 'last', startLine: 30 }),
      Object.freeze({ id: 'first', startLine: 10 }),
      Object.freeze({ id: 'middle', startLine: 20 }),
      Object.freeze({ id: 'same-line', startLine: 20 }),
    ]);

    // When: the nearest strictly adjacent command is requested.
    const result = findAdjacentCommand(entries, anchor, direction);

    // Then: equality is excluded and ties retain input order without mutating the array.
    expect(result).toBe(expected);
  });

  it.each(['previous', 'next'] as const)('handles an empty history for %s', (direction) => {
    // Given: no completed commands.
    const entries: { id: string; startLine: number }[] = [];

    // When: navigation is requested.
    const result = findAdjacentCommand(entries, 0, direction);

    // Then: there is no candidate.
    expect(result).toBeNull();
  });

  it('handles a single command on either side of the anchor', () => {
    // Given: one completed command.
    const entries = [{ id: 'only', startLine: 5 }];

    // When: the anchor is before, on, or after the command.
    const results = [
      findAdjacentCommand(entries, 0, 'next'),
      findAdjacentCommand(entries, 5, 'next'),
      findAdjacentCommand(entries, 5, 'previous'),
      findAdjacentCommand(entries, 10, 'previous'),
    ];

    // Then: only strictly adjacent positions produce a candidate.
    expect(results).toEqual(['only', null, null, 'only']);
  });
});
