import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalCommandBlockGauge } from './command-block-gauge';
import { createCommandBlockRowsFixture as fixture } from './__test-utils__/command-block-rows';

describe('createTerminalCommandBlockGauge', () => {
  it('clears rows in the alternate buffer and rebuilds on return without owning history markers', () => {
    // Given: a completed normal-buffer block owns independent gauge rows.
    const f = fixture();
    const handle = createTerminalCommandBlockGauge(f.terminal as unknown as Terminal, f.entry);
    const previousRows = [...f.decorations];
    const previousMarkers = [...f.markers];

    // When: the buffer changes to alternate, is resized there, then returns to normal.
    f.changeBuffer('alternate');
    f.resize();
    expect(f.decorations).toHaveLength(3);
    expect(previousRows.every((row) => row.dispose.mock.calls.length === 1)).toBe(true);
    expect(previousMarkers.every((value) => value.dispose.mock.calls.length === 1)).toBe(true);
    f.changeBuffer('normal');

    // Then: the rows are restored, history survives, and all subscriptions/resources clean up once.
    expect(f.decorations).toHaveLength(6);
    expect(f.markers.slice(3).map((value) => value.line)).toEqual([4, 5, 6]);
    handle.dispose();
    handle.dispose();
    expect(f.prompt.dispose).not.toHaveBeenCalled();
    expect(f.endMarker.dispose).not.toHaveBeenCalled();
    expect(f.resizeDisposed).toHaveBeenCalledOnce();
    expect(f.bufferChangedDisposed).toHaveBeenCalledOnce();
    expect(f.decorations.every((row) => row.dispose.mock.calls.length === 1)).toBe(true);
  });
  it.each([
    { code: 0, status: 'success' },
    { code: 9, status: 'error' },
    { code: null, status: 'unknown' },
  ])('distinguishes status $status without changing buffer content', ({ code, status }) => {
    // Given: a completed entry has a known or unknown exit status.
    const f = fixture();
    f.entry.exitCode = code;

    // When: its first row is rendered.
    const handle = createTerminalCommandBlockGauge(f.terminal as unknown as Terminal, f.entry);
    const element = document.createElement('div');
    f.decorations[0]?.render(element);

    // Then: CSS can distinguish an error and an unknown status without treating either as success.
    expect(element.dataset.status).toBe(status);
    expect(element).toHaveAttribute('aria-hidden', 'true');
    handle.dispose();
  });

  it.each([
    { column: 0, expected: 3 },
    { column: 2, expected: 4 },
  ])('respects the exclusive end column $column', ({ column, expected }) => {
    // Given: a prompt and output occupy several physical rows.
    const f = fixture(column);

    // When: the completed block is decorated.
    const handle = createTerminalCommandBlockGauge(f.terminal as unknown as Terminal, f.entry);

    // Then: each covered row has a non-interactive gutter gauge, including empty rows.
    expect(f.markers.map((value) => value.line)).toEqual(
      Array.from({ length: expected }, (_, index) => 4 + index),
    );
    for (const [index, value] of f.decorations.entries()) {
      expect(f.terminal.registerDecoration).toHaveBeenNthCalledWith(index + 1, {
        marker: f.markers[index],
        width: 1,
        anchor: 'left',
        height: 1,
        layer: 'bottom',
      });
      const element = document.createElement('div');
      value.render(element);
      expect(element).toHaveClass('evermore-command-block-gauge');
      expect(element.dataset.start).toBe(String(index === 0));
      expect(element.dataset.end).toBe(String(index === expected - 1));
    }
    handle.dispose();
  });

  it('marks both visual edges on a single-row block', () => {
    // Given: the exclusive output end is on the prompt's own row.
    const f = fixture(0, 4, 4);

    // When: the gauge is shown.
    const handle = createTerminalCommandBlockGauge(f.terminal as unknown as Terminal, f.entry);

    // Then: the prompt retains a gauge without extending into a next row.
    const element = document.createElement('div');
    f.decorations[0]?.render(element);
    expect(element.dataset.start).toBe('true');
    expect(element.dataset.end).toBe('true');
    handle.dispose();
  });

  it('rebuilds from current markers on resize without disposing history markers', () => {
    // Given: one completed block owns independent row markers.
    const f = fixture();
    const handle = createTerminalCommandBlockGauge(f.terminal as unknown as Terminal, f.entry);
    const previousMarkers = [...f.markers];
    const previousDecorations = [...f.decorations];

    // When: reflow changes its rows and terminal width, then cleanup runs twice.
    Object.assign(f.entry.outputEnd.marker, { line: 9 });
    f.terminal.cols = 40;
    f.resize();
    expect(f.terminal.registerDecoration).toHaveBeenLastCalledWith({
      marker: f.markers.at(-1),
      width: 1,
      anchor: 'left',
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
