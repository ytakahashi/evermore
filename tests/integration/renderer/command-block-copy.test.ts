import { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test';
import { attachCommandBlocks } from '../../../src/renderer/src/components/terminal/command-blocks';

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

const normalCommand =
  '\x1b]133;A\x07header\r\n\x1b]133;B\x07$ echo result\r\n' +
  '\x1b]633;E;echo result\x07\x1b]133;C\x07result\r\n' +
  '\x1b]133;D;0\x07\x1b]133;A\x07\x1b]133;B\x07$ ';

function fixture(): {
  terminal: Terminal;
  registered: MockInstance<Terminal['registerDecoration']>;
  press: (key: string, init?: KeyboardEventInit) => boolean | undefined;
  dispose: () => void;
} {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const registered = vi.spyOn(terminal, 'registerDecoration');
  const attached = vi.spyOn(terminal, 'attachCustomKeyEventHandler');
  const blocks = attachCommandBlocks(terminal);
  const handler = attached.mock.calls[0]?.[0];
  const press = (key: string, init: KeyboardEventInit = {}): boolean | undefined => {
    const event = new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true, ...init });
    return handler?.(event);
  };
  return {
    terminal,
    registered,
    press,
    dispose: () => {
      blocks.dispose();
      terminal.dispose();
    },
  };
}

describe('selected command copy with real xterm', () => {
  const clipboard = vi.fn(() => Promise.resolve());
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  beforeEach(() => {
    clipboard.mockReset();
    clipboard.mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    vi.restoreAllMocks();
  });

  it('keeps feedback independent of selection and removes it when the shared timer expires', async () => {
    // Given: a completed command is selected using the real attachment and history.
    const f = fixture();
    try {
      await write(f.terminal, normalCommand);
      f.press('ArrowUp');
      vi.useFakeTimers();

      // When: a keyboard copy completes and selection is cleared before feedback expires.
      f.press('ç', { code: 'KeyC', altKey: true });
      await vi.advanceTimersByTimeAsync(0);
      const feedback = f.registered.mock.results.at(-1)?.value;
      expect(feedback).toBeDefined();
      expect(f.registered.mock.calls.at(-1)?.[0]).toMatchObject({ layer: 'top', anchor: 'right' });
      expect(f.press('Escape', { metaKey: false })).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(feedback?.isDisposed).toBe(false);
      await vi.advanceTimersByTimeAsync(500);

      // Then: the original result retains its duration without requiring a selected block.
      expect(clipboard).toHaveBeenCalledExactlyOnceWith('result');
      expect(feedback?.isDisposed).toBe(true);
      expect(f.press('ç', { code: 'KeyC', altKey: true })).toBe(true);
    } finally {
      f.dispose();
    }
  });

  it('highlights the exclusive block range and copies both modes without text-selection changes', async () => {
    // Given: a completed command has a multi-line prompt and verified output.
    const f = fixture();
    const selectionChanged = vi.fn();
    f.terminal.onSelectionChange(selectionChanged);
    try {
      await write(f.terminal, normalCommand);

      // When: the command is selected through navigation, then explicitly copied in each mode.
      f.press('ArrowUp');
      const highlights = f.registered.mock.calls.filter(
        ([options]) => options.layer === 'bottom' && options.width !== 1,
      );
      expect(highlights.map(([options]) => options.marker.line)).toEqual([0, 1, 2]);
      expect(clipboard).not.toHaveBeenCalled();
      expect(f.press('C', { code: 'KeyC', shiftKey: true })).toBe(false);
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('$ echo result\nresult'));
      await vi.waitFor(() =>
        expect(f.registered.mock.calls.filter(([options]) => options.layer === 'top')).toHaveLength(
          2,
        ),
      );
      expect(f.press('ç', { code: 'KeyC', altKey: true })).toBe(false);
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('result'));

      // Then: copying is explicit, independent of xterm selection, and feedback anchors at the block start.
      expect(clipboard).toHaveBeenCalledTimes(2);
      expect(selectionChanged).not.toHaveBeenCalled();
      expect(f.registered.mock.calls.at(-1)?.[0]).toMatchObject({ anchor: 'right', layer: 'top' });
      expect(f.registered.mock.calls.at(-1)?.[0].marker.line).toBe(0);
    } finally {
      f.dispose();
    }
  });

  it('retains selection across manual scrolling, rebuilds it on resize, and clears it on alternate-screen entry', async () => {
    // Given: a selected command is above substantial later output.
    const f = fixture();
    try {
      await write(f.terminal, normalCommand);
      await write(f.terminal, '\r\n'.repeat(40));
      f.press('ArrowUp');

      // When: the user scrolls away and terminal reflow changes the viewport width.
      f.terminal.scrollToBottom();
      f.terminal.resize(40, 24);
      const highlights = f.registered.mock.calls.filter(
        ([options]) => options.layer === 'bottom' && options.width !== 1,
      );
      expect(highlights.at(-1)?.[0].width).toBe(40);
      f.press('C', { code: 'KeyC', shiftKey: true });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('$ echo result\nresult'));
      await write(f.terminal, '\x1b[?1049h');
      await write(f.terminal, '\x1b[?1049l');

      // Then: resizing and scrolling preserve the copy target, while alternate-screen entry clears it.
      expect(f.press('C', { code: 'KeyC', shiftKey: true })).toBe(true);
      expect(clipboard).toHaveBeenCalledOnce();
    } finally {
      f.dispose();
    }
  });

  it('rejects output copied after a non-newline completion reflows even if columns are restored', async () => {
    // Given: output completed in the middle of a physical row.
    const f = fixture();
    try {
      await write(
        f.terminal,
        '\x1b]133;A\x07\x1b]133;B\x07$ printf result\r\n' +
          '\x1b]633;E;printf result\x07\x1b]133;C\x07result' +
          '\x1b]133;D;0\x07\x1b]133;A\x07\x1b]133;B\x07$ ',
      );
      f.press('ArrowUp');

      // When: width changes and then returns before an explicit output copy.
      f.terminal.resize(40, 24);
      f.terminal.resize(80, 24);
      expect(f.press('ç', { code: 'KeyC', altKey: true })).toBe(false);

      // Then: invalid end-column metadata cannot be bypassed using the keyboard.
      expect(clipboard).not.toHaveBeenCalled();
      expect(f.registered.mock.calls.at(-1)?.[0].marker.line).toBe(0);
    } finally {
      f.dispose();
    }
  });

  it('shows failure rather than overwriting the clipboard for an empty output-only copy', async () => {
    // Given: a completed command produced no output.
    const f = fixture();
    try {
      await write(
        f.terminal,
        '\x1b]133;A\x07\x1b]133;B\x07$ true\r\n' +
          '\x1b]633;E;true\x07\x1b]133;C\x07\x1b]133;D;0\x07' +
          '\x1b]133;A\x07\x1b]133;B\x07$ ',
      );
      f.press('ArrowUp');

      // When: only output is requested, followed by command-and-output.
      f.press('ç', { code: 'KeyC', altKey: true });
      expect(clipboard).not.toHaveBeenCalled();
      f.press('C', { code: 'KeyC', shiftKey: true });
      await vi.waitFor(() => expect(clipboard).toHaveBeenCalledWith('$ true'));

      // Then: the explicit command copy remains available after the empty-output failure.
      expect(clipboard).toHaveBeenCalledOnce();
    } finally {
      f.dispose();
    }
  });
});
