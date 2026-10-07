import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalCommandBlockDecoration } from './command-block-decoration';
import type { TerminalCommandHistoryEntry } from './command-history';

interface TestMarker extends IMarker {
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}
interface TestDecoration {
  dispose: ReturnType<typeof vi.fn>;
  render: (element: HTMLElement) => void;
}
interface HighlightFixture {
  terminal: {
    cols: number;
    buffer: {
      active: { type: string };
      normal: { baseY: number; cursorY: number; length: number };
    };
    registerMarker: ReturnType<typeof vi.fn<(offset: number) => TestMarker>>;
    registerDecoration: ReturnType<typeof vi.fn<() => IDecoration | undefined>>;
    onResize: (listener: () => void) => IDisposable;
  };
  entry: TerminalCommandHistoryEntry;
  markers: TestMarker[];
  decorations: TestDecoration[];
  prompt: TestMarker;
  endMarker: TestMarker;
  resizeDisposed: ReturnType<typeof vi.fn>;
  resize: () => void;
}

function marker(line: number): TestMarker {
  return {
    id: line,
    line,
    isDisposed: false,
    onDispose: () => ({ dispose: () => undefined }),
    dispose: vi.fn(),
  };
}

function fixture(endColumn = 0, start = 4, end = 7): HighlightFixture {
  const markers: TestMarker[] = [];
  const decorations: {
    dispose: ReturnType<typeof vi.fn>;
    render: (element: HTMLElement) => void;
  }[] = [];
  let resize = (): void => undefined;
  const resizeDisposed = vi.fn();
  const terminal = {
    cols: 80,
    buffer: { active: { type: 'normal' }, normal: { baseY: 10, cursorY: 2, length: 30 } },
    registerMarker: vi.fn((offset: number) => {
      const value = marker(12 + offset);
      markers.push(value);
      return value;
    }),
    registerDecoration: vi.fn<() => IDecoration | undefined>(() => {
      let rendered = (_element: HTMLElement): void => undefined;
      const result = {
        dispose: vi.fn(),
        render: (element: HTMLElement) => rendered(element),
        onRender: (listener: typeof rendered) => {
          rendered = listener;
          return { dispose: vi.fn() };
        },
      };
      decorations.push(result);
      return result as unknown as IDecoration;
    }),
    onResize: (listener: () => void) => {
      resize = listener;
      return { dispose: resizeDisposed };
    },
  };
  const prompt = marker(start);
  const endMarker = marker(end);
  const entry: TerminalCommandHistoryEntry = {
    id: 'command',
    command: 'echo example',
    blockStartMarker: prompt,
    promptMarker: prompt,
    outputStart: { marker: prompt, column: 0 },
    outputEnd: { marker: endMarker, column: endColumn },
    outputFingerprint: { length: 0, hash: '811c9dc5' },
    completionCols: 80,
    endsAtLineStart: endColumn === 0,
  };
  return {
    terminal,
    entry,
    markers,
    decorations,
    prompt,
    endMarker,
    resizeDisposed,
    resize: () => resize(),
  };
}

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

  it('retains at least the prompt row for an empty same-line output', () => {
    // Given: the exclusive output end is on the prompt's own row.
    const f = fixture(0, 4, 4);

    // When: selection is shown.
    const handle = createTerminalCommandBlockDecoration(f.terminal as unknown as Terminal, f.entry);

    // Then: the prompt remains highlighted without extending into a next row.
    expect(f.markers.map((value) => value.line)).toEqual([4]);
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

  it('rolls back partial decorations when xterm rejects a row', () => {
    // Given: registration succeeds once and then fails.
    const f = fixture();
    f.terminal.registerDecoration.mockReturnValueOnce({
      dispose: vi.fn(),
      onRender: () => ({ dispose: vi.fn() }),
    } as unknown as IDecoration);
    f.terminal.registerDecoration.mockReturnValueOnce(undefined);

    // When: the block decoration is attempted.
    const handle = createTerminalCommandBlockDecoration(f.terminal as unknown as Terminal, f.entry);

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

    // When: a highlight is requested.
    const handle = createTerminalCommandBlockDecoration(f.terminal as unknown as Terminal, f.entry);

    // Then: no partial marker or decoration is registered.
    expect(f.terminal.registerMarker).not.toHaveBeenCalled();
    expect(f.terminal.registerDecoration).not.toHaveBeenCalled();
    handle.dispose();
  });
});
