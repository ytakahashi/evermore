import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalCommandBlockDecoration } from './command-block-decoration';
import { createCommandBlockRowsFixture as fixture } from './__test-utils__/command-block-rows';

describe('createTerminalCommandBlockDecoration', () => {
  it.each([
    { column: 0, expected: 3 },
    { column: 2, expected: 4 },
  ])('respects the exclusive end column $column', ({ column, expected }) => {
    // Given: a prompt and output occupy several physical rows.
    const f = fixture(column);

    // When: the selected block is decorated.
    const handle = createTerminalCommandBlockDecoration(f.terminal as unknown as Terminal, f.entry);

    // Then: each covered row has full-width non-interactive DOM presentation, including empty cells.
    expect(f.markers.map((value) => value.line)).toEqual(
      Array.from({ length: expected }, (_, index) => 4 + index),
    );
    for (const [index, value] of f.decorations.entries()) {
      expect(f.terminal.registerDecoration).toHaveBeenNthCalledWith(index + 1, {
        marker: f.markers[index],
        width: 80,
        height: 1,
        layer: 'bottom',
      });
      const element = document.createElement('div');
      value.render(element);
      expect(element).toHaveClass('evermore-command-block-selection');
    }
    handle.dispose();
  });

  it('rebuilds from current markers and columns on resize without disposing history markers', () => {
    // Given: one block is selected and owns independent row markers.
    const f = fixture();
    const handle = createTerminalCommandBlockDecoration(f.terminal as unknown as Terminal, f.entry);
    const previousMarkers = [...f.markers];
    const previousDecorations = [...f.decorations];

    // When: reflow changes its rows and terminal width, then cleanup runs twice.
    Object.assign(f.entry.outputEnd.marker, { line: 9 });
    f.terminal.cols = 40;
    f.resize();
    expect(f.terminal.registerDecoration).toHaveBeenLastCalledWith({
      marker: f.markers.at(-1),
      width: 40,
      height: 1,
      layer: 'bottom',
    });
    handle.dispose();
    handle.dispose();

    // Then: all old and rebuilt resources are released, but borrowed history markers remain owned by history.
    expect(previousMarkers.every((value) => vi.mocked(value.dispose).mock.calls.length === 1)).toBe(
      true,
    );
    expect(previousDecorations.every((value) => value.dispose.mock.calls.length === 1)).toBe(true);
    expect(f.markers.every((value) => vi.mocked(value.dispose).mock.calls.length === 1)).toBe(true);
    expect(f.prompt.dispose).not.toHaveBeenCalled();
    expect(f.endMarker.dispose).not.toHaveBeenCalled();
    expect(f.resizeDisposed).toHaveBeenCalledOnce();
  });
});
