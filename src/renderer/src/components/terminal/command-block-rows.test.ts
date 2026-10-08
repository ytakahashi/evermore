import type { IDecoration, Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalCommandBlockRows } from './command-block-rows';
import { createCommandBlockRowsFixture as fixture } from './__test-utils__/command-block-rows';

const presentation = {
  options: () => ({ width: 1, height: 1, layer: 'bottom' as const }),
  onRender: vi.fn(),
};

describe('createTerminalCommandBlockRows', () => {
  it('retains at least the prompt row for an empty same-line output', () => {
    // Given: the exclusive output end is on the prompt's own row.
    const f = fixture(0, 4, 4);

    // When: row decorations are requested.
    const handle = createTerminalCommandBlockRows(
      f.terminal as unknown as Terminal,
      f.entry,
      presentation,
    );

    // Then: the prompt retains one decoration without extending into a next row.
    expect(f.markers.map((value) => value.line)).toEqual([4]);
    handle.dispose();
  });

  it('rolls back partial decorations when xterm rejects a row', () => {
    // Given: registration succeeds once and then fails.
    const f = fixture();
    f.terminal.registerDecoration.mockReturnValueOnce({
      dispose: vi.fn(),
      onRender: () => ({ dispose: vi.fn() }),
    } as unknown as IDecoration);
    f.terminal.registerDecoration.mockReturnValueOnce(undefined);

    // When: the block decoration is attempted.
    const handle = createTerminalCommandBlockRows(
      f.terminal as unknown as Terminal,
      f.entry,
      presentation,
    );

    // Then: even the failing row's independent marker is released.
    expect(f.markers).toHaveLength(2);
    expect(f.markers.every((value) => vi.mocked(value.dispose).mock.calls.length === 1)).toBe(true);
    handle.dispose();
  });
  it.each([
    { start: -1, end: 7 },
    { start: 4, end: 3 },
    { start: 4, end: 30 },
  ])('does not decorate an invalid buffer range %j', ({ start, end }) => {
    // Given: one endpoint is outside the retained buffer or reversed.
    const f = fixture(0, start, end);

    // When: row decorations are requested.
    const handle = createTerminalCommandBlockRows(
      f.terminal as unknown as Terminal,
      f.entry,
      presentation,
    );

    // Then: no partial marker or decoration is registered.
    expect(f.terminal.registerMarker).not.toHaveBeenCalled();
    expect(f.terminal.registerDecoration).not.toHaveBeenCalled();
    handle.dispose();
  });
});
