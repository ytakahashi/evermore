import type { IDecoration, IDisposable, IMarker } from '@xterm/xterm';
import { vi } from 'vite-plus/test';
import type { TerminalCommandHistoryEntry } from '../command-history';

interface TestMarker extends IMarker {
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
}
interface TestDecoration {
  dispose: ReturnType<typeof vi.fn>;
  render: (element: HTMLElement) => void;
}
export interface CommandBlockRowsFixture {
  terminal: {
    cols: number;
    buffer: {
      active: { type: string };
      normal: { baseY: number; cursorY: number; length: number };
      onBufferChange: (listener: () => void) => IDisposable;
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
  changeBuffer: (type: string) => void;
  bufferChangedDisposed: ReturnType<typeof vi.fn>;
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

/** Provides an isolated terminal adapter for row decoration lifecycle tests. */
export function createCommandBlockRowsFixture(
  endColumn = 0,
  start = 4,
  end = 7,
): CommandBlockRowsFixture {
  const markers: TestMarker[] = [];
  const decorations: {
    dispose: ReturnType<typeof vi.fn>;
    render: (element: HTMLElement) => void;
  }[] = [];
  let resize = (): void => undefined;
  const resizeDisposed = vi.fn();
  const bufferChangedDisposed = vi.fn();
  let bufferChanged = (): void => undefined;
  const terminal = {
    cols: 80,
    buffer: {
      active: { type: 'normal' },
      normal: { baseY: 10, cursorY: 2, length: 30 },
      onBufferChange: (listener: () => void) => {
        bufferChanged = listener;
        return { dispose: bufferChangedDisposed };
      },
    },
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
    exitCode: null,
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
    bufferChangedDisposed,
    changeBuffer: (type) => {
      terminal.buffer.active.type = type;
      bufferChanged();
    },
    resize: () => resize(),
  };
}
