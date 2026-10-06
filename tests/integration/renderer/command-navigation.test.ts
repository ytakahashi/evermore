import { Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vite-plus/test';
import { attachCommandBlocks } from '../../../src/renderer/src/components/terminal/command-blocks';

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe('command navigation with xterm shell integration', () => {
  it('continues across commands below the viewport limit and forgets trimmed history', async () => {
    // Given: three completed commands in a buffer only slightly taller than the viewport.
    const terminal = new Terminal({ cols: 80, rows: 5, allowProposedApi: true });
    const attachHandler = vi.spyOn(terminal, 'attachCustomKeyEventHandler');
    const scroll = vi.spyOn(terminal, 'scrollToLine');
    const blocks = attachCommandBlocks(terminal);
    const handler = attachHandler.mock.calls[0]?.[0];
    const press = (key: string): boolean | undefined =>
      handler?.(new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true }));
    try {
      for (const command of ['one', 'two', 'three']) {
        await write(
          terminal,
          `\x1b]133;A\x07\x1b]133;B\x07$ ${command}\r\n` +
            `\x1b]633;E;${command}\x07\x1b]133;C\x07` +
            'output\r\n\x1b]133;D;0\x07',
        );
      }

      // When: navigation moves forward across the two commands near the buffer bottom.
      press('ArrowUp');
      press('ArrowUp');
      press('ArrowUp');
      press('ArrowDown');
      press('ArrowDown');
      press('ArrowUp');

      // Then: the command id remains the anchor even when scrolling cannot put it at the top.
      expect(scroll.mock.calls.map(([line]) => line)).toEqual([4, 2, 0, 2, 4, 2]);
      expect(terminal.buffer.normal.viewportY).toBe(2);

      // When: clearing scrollback removes the oldest command and shifts the surviving markers.
      await write(terminal, '\x1b[3J');
      scroll.mockClear();
      press('ArrowDown');

      // Then: the surviving command's shifted marker supplies the next destination.
      expect(scroll).toHaveBeenLastCalledWith(2);
    } finally {
      blocks.dispose();
      terminal.dispose();
    }
  });

  it.each([0, 50])(
    'starts at the latest visible command in a tall terminal with %s preceding lines',
    async (precedingLines) => {
      // Given: the latest commands fit inside a 40-row viewport, with or without scrollback.
      const terminal = new Terminal({ cols: 80, rows: 40, allowProposedApi: true });
      const attachHandler = vi.spyOn(terminal, 'attachCustomKeyEventHandler');
      const scroll = vi.spyOn(terminal, 'scrollToLine');
      const bottom = vi.spyOn(terminal, 'scrollToBottom');
      const blocks = attachCommandBlocks(terminal);
      const handler = attachHandler.mock.calls[0]?.[0];
      const press = (key: string): boolean | undefined =>
        handler?.(new KeyboardEvent('keydown', { key, metaKey: true, cancelable: true }));
      try {
        await write(terminal, 'earlier output\r\n'.repeat(precedingLines));
        for (const command of ['older', 'latest']) {
          await write(
            terminal,
            `\x1b]133;A\x07\x1b]133;B\x07$ ${command}\r\n` +
              `\x1b]633;E;${command}\x07\x1b]133;C\x07` +
              'output\r\n\x1b]133;D;0\x07',
          );
        }
        await write(terminal, '\x1b]133;A\x07\x1b]133;B\x07$ ');
        expect(terminal.buffer.normal.viewportY).toBe(terminal.buffer.normal.baseY);

        // When: the first shortcut is pressed at the current prompt, followed by adjacent jumps.
        press('ArrowUp');
        press('ArrowUp');
        press('ArrowDown');
        press('ArrowDown');

        // Then: the latest visible command is reached first, and moving past it returns to the bottom.
        expect(scroll.mock.calls.map(([line]) => line)).toEqual([
          precedingLines + 2,
          precedingLines,
          precedingLines + 2,
        ]);
        expect(bottom).toHaveBeenCalledOnce();
      } finally {
        blocks.dispose();
        terminal.dispose();
      }
    },
  );

  it('records a command after its prompt editor temporarily activates the alternate buffer', async () => {
    // Given: a real xterm prompt has started accepting input in the normal buffer.
    const terminal = new Terminal({ cols: 80, rows: 40, allowProposedApi: true });
    const attachHandler = vi.spyOn(terminal, 'attachCustomKeyEventHandler');
    const scroll = vi.spyOn(terminal, 'scrollToLine');
    const blocks = attachCommandBlocks(terminal);
    const handler = attachHandler.mock.calls[0]?.[0];
    try {
      await write(terminal, '\x1b]133;A\x07header\r\n\x1b]133;B\x07$ ');

      // When: an alternate-screen editor returns and the edited command executes.
      await write(terminal, '\x1b[?1049heditor\x1b[?1049l');
      await write(
        terminal,
        'echo edited\r\n\x1b]633;E;echo edited\x07\x1b]133;C\x07' +
          'edited\r\n\x1b]133;D;0\x07\x1b]133;A\x07\x1b]133;B\x07$ ',
      );
      const handled = handler?.(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true }));

      // Then: history retains the command and its multi-line prompt start.
      expect(handled).toBe(false);
      expect(scroll).toHaveBeenLastCalledWith(0);
    } finally {
      blocks.dispose();
      terminal.dispose();
    }
  });

  it.each([true, false])('jumps to the prompt start with OSC A present: %s', async (withStart) => {
    // Given: a real xterm parser, marker lifecycle, history, and command attachment.
    const terminal = new Terminal({ cols: 80, rows: 3, allowProposedApi: true });
    const attachHandler = vi.spyOn(terminal, 'attachCustomKeyEventHandler');
    const scroll = vi.spyOn(terminal, 'scrollToLine');
    const select = vi.spyOn(terminal, 'select');
    const selectionChanged = vi.fn();
    const input = vi.fn();
    terminal.onSelectionChange(selectionChanged);
    terminal.onData(input);
    const blocks = attachCommandBlocks(terminal);
    const handler = attachHandler.mock.calls[0]?.[0];
    try {
      await write(terminal, 'older output\r\n');
      const startLine = terminal.buffer.normal.baseY + terminal.buffer.normal.cursorY;
      await write(
        terminal,
        `${withStart ? '\x1b]133;A\x07' : ''}prompt header\r\n` +
          '\x1b]133;B\x07$ echo hello\r\n' +
          '\x1b]633;E;echo hello\x07\x1b]133;C\x07' +
          'hello\r\n\x1b]133;D;0\x07\x1b]133;A\x07' +
          'next prompt\r\n\x1b]133;B\x07$ \r\n\r\n\r\n',
      );

      // When: the completed command is reached through the installed key handler.
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        metaKey: true,
        cancelable: true,
      });
      const handled = handler?.(event);

      // Then: A includes the header; without A, B is the compatible fallback.
      expect(handled).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(scroll).toHaveBeenLastCalledWith(startLine + (withStart ? 0 : 1));
      expect(terminal.buffer.normal.viewportY).toBe(startLine + (withStart ? 0 : 1));
      expect(select).not.toHaveBeenCalled();
      expect(selectionChanged).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();

      // When: a TUI activates the alternate screen.
      await write(terminal, '\x1b[?1049h');
      scroll.mockClear();
      const alternateEvent = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        metaKey: true,
        cancelable: true,
      });

      // Then: the same shortcut passes through without scrolling or cancellation.
      expect(handler?.(alternateEvent)).toBe(true);
      expect(alternateEvent.defaultPrevented).toBe(false);
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      blocks.dispose();
      terminal.dispose();
    }
  });
});
