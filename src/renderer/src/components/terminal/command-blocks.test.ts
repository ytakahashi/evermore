import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { attachCommandBlocks } from './command-blocks';

const integrationMock = vi.hoisted(() => {
  interface Entry {
    id: string;
    blockStartMarker?: { line: number };
  }

  interface HistoryOptions {
    terminal: unknown;
    onCommandCompleted: (entry: Entry) => void;
    onCommandRemoved: (entry: Entry) => void;
  }

  class MockTerminalCommandHistory {
    public readonly dispose = vi.fn();
    public entries: Entry[] = [];
    public getCompletedCommands(): Entry[] {
      return this.entries;
    }
    public readonly options: HistoryOptions;

    public constructor(options: HistoryOptions) {
      this.options = options;
      integrationMock.historyInstances.push(this);
    }

    public emitCompleted(entry: Entry): void {
      this.entries = [...this.entries.filter((current) => current.id !== entry.id), entry];
      this.options.onCommandCompleted(entry);
    }

    public emitRemoved(entry: Entry): void {
      this.entries = this.entries.filter((current) => current.id !== entry.id);
      this.options.onCommandRemoved(entry);
    }
  }

  return {
    historyInstances: [] as MockTerminalCommandHistory[],
    MockTerminalCommandHistory,
    createDecoration: vi.fn(),
    createGauge: vi.fn(() => ({ dispose: vi.fn() })),
    hoverInstances: [] as { dispose: ReturnType<typeof vi.fn> }[],
    createHighlight: vi.fn(() => ({ dispose: vi.fn() })),
    copies: [] as { dispose: ReturnType<typeof vi.fn>; copy: ReturnType<typeof vi.fn> }[],
  };
});

vi.mock('./command-history', () => ({
  TerminalCommandHistory: integrationMock.MockTerminalCommandHistory,
}));

vi.mock('./command-copy-decoration', () => ({
  createTerminalCommandCopyDecoration: integrationMock.createDecoration,
}));

vi.mock('./command-block-decoration', () => ({
  createTerminalCommandBlockDecoration: integrationMock.createHighlight,
}));
vi.mock('./command-block-gauge', () => ({
  createTerminalCommandBlockGauge: integrationMock.createGauge,
}));
vi.mock('./command-toolbar-hover', () => ({
  TerminalCommandToolbarHover: class {
    public readonly dispose = vi.fn();
    public constructor() {
      integrationMock.hoverInstances.push(this);
    }
  },
}));

vi.mock('./command-copy', () => ({
  TerminalCommandCopyController: class {
    public readonly dispose = vi.fn();
    public readonly copy = vi.fn(() => Promise.resolve());
    public constructor() {
      integrationMock.copies.push(this);
    }
  },
}));

class NavigationTerminal {
  public readonly buffer = {
    active: { type: 'normal', viewportY: 30, baseY: 30, cursorY: 0 },
    onBufferChange: (listener: (buffer: { type: string }) => void) => {
      this.bufferListener = listener;
      return {
        dispose: () => {
          this.bufferListener = null;
        },
      };
    },
  };
  public handler: (event: KeyboardEvent) => boolean = () => true;
  public dataListener: (() => void) | null = null;
  public bufferListener: ((buffer: { type: string }) => void) | null = null;
  public readonly onData = vi.fn((listener: () => void) => {
    this.dataListener = listener;
    return {
      dispose: () => {
        this.dataListener = null;
      },
    };
  });
  public readonly attachCustomKeyEventHandler = vi.fn(
    (handler: (event: KeyboardEvent) => boolean) => {
      this.handler = handler;
    },
  );
  public readonly scrollToLine = vi.fn((line: number) => {
    const next = Math.min(line, this.buffer.active.baseY);
    if (next !== this.buffer.active.viewportY) {
      this.buffer.active.viewportY = next;
    }
  });
  public readonly scrollToBottom = vi.fn(() => {
    this.scrollToLine(this.buffer.active.baseY);
  });
  public readonly select = vi.fn();
  public readonly focus = vi.fn();
  public readonly selectLines = vi.fn();
}

function press(
  terminal: NavigationTerminal,
  key: string,
  options: KeyboardEventInit = {},
): boolean {
  return terminal.handler(
    new KeyboardEvent('keydown', { key, metaKey: true, ...options, cancelable: true }),
  );
}

describe('attachCommandBlocks', () => {
  let fake: NavigationTerminal;
  let terminal: Terminal;

  beforeEach(() => {
    fake = new NavigationTerminal();
    terminal = fake as unknown as Terminal;
    integrationMock.historyInstances.length = 0;
    integrationMock.createDecoration.mockReset();
    integrationMock.createHighlight.mockClear();
    integrationMock.copies.length = 0;
    integrationMock.hoverInstances.length = 0;
    integrationMock.createGauge.mockClear();
  });

  it('restores entry-removal focus only while the attachment is alive', () => {
    // Given: a completed command's view delegates focus restoration to its owner.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({ id: 'command-1' });
    const options = integrationMock.createDecoration.mock.calls[0]?.[0] as {
      onFocusedEntryRemoved: () => void;
    };

    // When: entry removal requests focus before and after owner teardown.
    options.onFocusedEntryRemoved();
    blocks.dispose();
    options.onFocusedEntryRemoved();

    // Then: a retained callback cannot focus a terminal whose owner has been disposed.
    expect(fake.focus).toHaveBeenCalledOnce();
  });

  it('creates a copy decoration for a completed command and disposes it when removed', () => {
    // Given: a terminal with a command history observer.
    const decoration = { dispose: vi.fn(), disposeForRemoval: vi.fn() };
    integrationMock.createDecoration.mockReturnValue(decoration);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };

    // When: the command completes and is removed from history.
    history?.emitCompleted(entry);
    history?.emitRemoved(entry);

    // Then: the decoration uses the same terminal and is released once.
    expect(history?.options.terminal).toBe(terminal);
    expect(integrationMock.createDecoration).toHaveBeenCalledWith({
      terminal,
      entry,
      copyController: integrationMock.copies[0],
      hover: integrationMock.hoverInstances[0],
      onDisposed: expect.any(Function),
      onFocusedEntryRemoved: expect.any(Function),
    });
    expect(decoration.disposeForRemoval).toHaveBeenCalledOnce();
    expect(decoration.dispose).not.toHaveBeenCalled();
    blocks.dispose();
    expect(decoration.disposeForRemoval).toHaveBeenCalledOnce();
    expect(decoration.dispose).not.toHaveBeenCalled();
  });

  it('replaces a previous decoration for an unexpected duplicate completion', () => {
    // Given: the first completion has a live decoration.
    const previous = { dispose: vi.fn() };
    const replacement = { dispose: vi.fn() };
    integrationMock.createDecoration.mockReturnValueOnce(previous).mockReturnValueOnce(replacement);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };
    history?.emitCompleted(entry);

    // When: the same id completes again.
    history?.emitCompleted(entry);

    // Then: only the replacement remains owned by the attachment.
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(replacement.dispose).not.toHaveBeenCalled();
    blocks.dispose();
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });

  it('forgets a decoration that disposes itself', () => {
    // Given: a copy decoration reports its own disposal.
    const decoration = { dispose: vi.fn(), disposeForRemoval: vi.fn() };
    integrationMock.createDecoration.mockReturnValue(decoration);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };
    history?.emitCompleted(entry);
    const onDisposed = integrationMock.createDecoration.mock.calls[0]?.[0].onDisposed as
      | (() => void)
      | undefined;

    // When: xterm disposes the decoration before history removes the command.
    onDisposed?.();
    history?.emitRemoved(entry);
    blocks.dispose();

    // Then: cleanup does not dispose it again.
    expect(decoration.dispose).not.toHaveBeenCalled();
  });

  it('keeps cleanup safe when xterm cannot create a decoration', () => {
    // Given: xterm cannot create a decoration for a completed command.
    integrationMock.createDecoration.mockReturnValue(null);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };

    // When: the command completes, is removed, and the attachment is disposed.
    history?.emitCompleted(entry);
    history?.emitRemoved(entry);
    blocks.dispose();

    // Then: no decoration is retained and history is released normally.
    expect(integrationMock.createDecoration).toHaveBeenCalledOnce();
    expect(history?.dispose).toHaveBeenCalledOnce();
  });

  it('disposes remaining decorations before command history', () => {
    // Given: two completed commands still have decorations.
    const order: string[] = [];
    integrationMock.createDecoration
      .mockReturnValueOnce({ dispose: () => order.push('decoration-1') })
      .mockReturnValueOnce({ dispose: () => order.push('decoration-2') });
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    history?.dispose.mockImplementation(() => {
      order.push('history');
    });
    history?.emitCompleted({ id: 'command-1' });
    history?.emitCompleted({ id: 'command-2' });

    // When: the attachment is disposed.
    blocks.dispose();

    // Then: both decorations are released before their history observer.
    expect(order).toEqual(['decoration-1', 'decoration-2', 'history']);
    expect(history?.dispose).toHaveBeenCalledOnce();
  });
  it('navigates using command ids when the viewport clamps at the bottom', () => {
    // Given: three commands, two of which cannot reach the top of the viewport.
    fake.buffer.active.baseY = 10;
    fake.buffer.active.viewportY = 10;
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    for (const line of [5, 15, 20]) {
      history?.emitCompleted({ id: `command-${line}`, blockStartMarker: { line } });
    }

    // When: navigation reaches both lower commands and returns above them.
    press(fake, 'ArrowUp');
    press(fake, 'ArrowDown');
    press(fake, 'ArrowDown');
    press(fake, 'ArrowUp');
    press(fake, 'ArrowUp');
    press(fake, 'ArrowUp');

    // Then: viewport equality does not stall consecutive jumps, and the oldest boundary is stable.
    expect(fake.scrollToLine.mock.calls.map(([line]) => line)).toEqual([5, 15, 20, 15, 5]);
    expect(fake.select).not.toHaveBeenCalled();
    expect(fake.selectLines).not.toHaveBeenCalled();
    blocks.dispose();
  });

  it.each([0, 100])(
    'starts at the current prompt when the viewport is at the bottom (baseY %s)',
    (baseY) => {
      // Given: completed commands are visible below the viewport's top edge.
      fake.buffer.active.baseY = baseY;
      fake.buffer.active.viewportY = baseY;
      fake.buffer.active.cursorY = 35;
      const blocks = attachCommandBlocks(terminal);
      const history = integrationMock.historyInstances[0];
      history?.emitCompleted({ id: 'older', blockStartMarker: { line: baseY + 10 } });
      history?.emitCompleted({ id: 'latest', blockStartMarker: { line: baseY + 25 } });

      // When: the first previous-command shortcut is pressed.
      press(fake, 'ArrowUp');
      press(fake, 'ArrowUp');

      // Then: visible commands are reached newest first even without scrollback.
      expect(fake.scrollToLine.mock.calls.map(([line]) => line)).toEqual([baseY + 25, baseY + 10]);
      blocks.dispose();
    },
  );

  it('starts at the viewport when scrolled away from the bottom', () => {
    // Given: the cursor is far below the manually scrolled viewport.
    fake.buffer.active.viewportY = 15;
    fake.buffer.active.cursorY = 20;
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    for (const line of [5, 10, 25, 40]) {
      history?.emitCompleted({ id: `command-${line}`, blockStartMarker: { line } });
    }

    // When: navigation is first requested from that viewport.
    press(fake, 'ArrowUp');

    // Then: the cursor does not pull navigation back to the most recent command.
    expect(fake.scrollToLine).toHaveBeenLastCalledWith(10);
    blocks.dispose();
  });

  it('returns to the bottom after the last command', () => {
    // Given: a navigable command above the viewport.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    press(fake, 'ArrowUp');

    // When: moving beyond the latest command, then navigating again.
    press(fake, 'ArrowDown');
    press(fake, 'ArrowUp');

    // Then: the bottom transition clears the old anchor.
    expect(fake.scrollToBottom).toHaveBeenCalledOnce();
    expect(fake.scrollToLine.mock.calls.map(([line]) => line)).toEqual([5, 30, 5]);
    blocks.dispose();
  });

  it.each([
    { metaKey: false },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { key: 'Escape' },
    { key: 'Enter' },
    { type: 'keyup' },
    { type: 'keypress' },
  ])('passes through unrelated keys or modifiers: %j', (options) => {
    // Given: completed history and a cancellable keyboard event.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    const { type = 'keydown', ...init } = options;
    const event = new KeyboardEvent(type, {
      key: 'ArrowUp',
      metaKey: true,
      cancelable: true,
      ...init,
    });

    // When: xterm offers an unrelated key event.
    const result = fake.handler(event);

    // Then: the event retains its default behavior and never navigates.
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(fake.scrollToLine).not.toHaveBeenCalled();
    blocks.dispose();
  });

  it('cancels the DOM default only for handled navigation keys', () => {
    // Given: one completed command.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true, cancelable: true });

    // When: the exact navigation shortcut is offered.
    const result = fake.handler(event);

    // Then: neither browser nor xterm default handling should continue.
    expect(result).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    blocks.dispose();
  });

  it.each([
    { key: 'Escape', metaKey: false, isComposing: true },
    { key: 'Escape', metaKey: false, keyCode: 229 },
    { key: 'ArrowUp', metaKey: true, isComposing: true },
    { key: 'ArrowDown', metaKey: true, keyCode: 229 },
    { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true, isComposing: true },
    { key: 'ç', code: 'KeyC', metaKey: true, altKey: true, keyCode: 229 },
  ])('preserves selection and IME handling during composition: %j', (init) => {
    // Given: a command was selected before IME composition started without emitting onData.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    press(fake, 'ArrowUp');
    fake.scrollToLine.mockClear();
    const highlight = integrationMock.createHighlight.mock.results[0]?.value;
    const event = new KeyboardEvent('keydown', { ...init, cancelable: true });

    // When: a composition event resembles a command shortcut.
    const result = fake.handler(event);

    // Then: xterm and the IME receive it, while navigation, selection and clipboard remain unchanged.
    expect(result).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(fake.scrollToLine).not.toHaveBeenCalled();
    expect(highlight?.dispose).not.toHaveBeenCalled();
    expect(integrationMock.copies[0]?.copy).not.toHaveBeenCalled();
    expect(press(fake, 'C', { code: 'KeyC', shiftKey: true })).toBe(false);
    expect(integrationMock.copies[0]?.copy).toHaveBeenCalledWith('command-and-output');
    expect(press(fake, 'Escape', { metaKey: false })).toBe(false);
    expect(highlight?.dispose).toHaveBeenCalledOnce();
    blocks.dispose();
  });

  it('passes shortcuts through with no history or an alternate buffer', () => {
    // Given: an attachment initially has no completed history.
    const blocks = attachCommandBlocks(terminal);

    // When: shortcuts arrive before integration, and then inside a full-screen application.
    const empty = press(fake, 'ArrowUp');
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    fake.buffer.active.type = 'alternate';
    const alternate = press(fake, 'ArrowUp');

    // Then: both situations preserve normal key handling.
    expect([empty, alternate]).toEqual([true, true]);
    expect(fake.scrollToLine).not.toHaveBeenCalled();
    blocks.dispose();
  });

  it.each(['input', 'scroll', 'buffer-change', 'removal'] as const)(
    'resets the anchor after %s',
    (reason) => {
      // Given: the latest command has been reached below the scroll limit.
      fake.buffer.active.baseY = 10;
      fake.buffer.active.viewportY = 10;
      const blocks = attachCommandBlocks(terminal);
      const history = integrationMock.historyInstances[0];
      const older = { id: 'older', blockStartMarker: { line: 5 } };
      const newer = { id: 'newer', blockStartMarker: { line: 15 } };
      history?.emitCompleted(older);
      history?.emitCompleted(newer);
      press(fake, 'ArrowUp');
      press(fake, 'ArrowDown');

      // When: something outside command navigation invalidates its anchor.
      if (reason === 'input') {
        fake.dataListener?.();
      }
      if (reason === 'scroll') {
        fake.scrollToLine(7);
      }
      if (reason === 'buffer-change') {
        fake.bufferListener?.({ type: 'alternate' });
        fake.bufferListener?.({ type: 'normal' });
      }
      if (reason === 'removal') {
        history?.emitRemoved(newer);
        history?.emitCompleted({ id: 'replacement', blockStartMarker: { line: 15 } });
      }
      fake.scrollToLine.mockClear();
      press(fake, 'ArrowDown');

      // Then: the viewport, rather than the stale command, determines the next destination.
      expect(fake.scrollToLine).toHaveBeenCalledWith(15);
      expect(fake.scrollToBottom).not.toHaveBeenCalled();
      blocks.dispose();
    },
  );

  it.each([true, false])(
    'reads marker positions after reflow with the anchor still shown: %s',
    (stillShown) => {
      // Given: navigation has reached a command below the viewport limit.
      fake.buffer.active.baseY = 10;
      fake.buffer.active.viewportY = 10;
      const blocks = attachCommandBlocks(terminal);
      const history = integrationMock.historyInstances[0];
      const first = { id: 'first', blockStartMarker: { line: 5 } };
      const second = { id: 'second', blockStartMarker: { line: 15 } };
      history?.emitCompleted(first);
      history?.emitCompleted(second);
      press(fake, 'ArrowUp');
      press(fake, 'ArrowDown');

      // When: reflow moves both markers without deleting their entries.
      first.blockStartMarker.line = 3;
      second.blockStartMarker.line = 4;
      if (stillShown) {
        fake.buffer.active.viewportY = 4;
      }
      press(fake, 'ArrowUp');

      // Then: a matching viewport retains the command anchor; otherwise navigation starts from the viewport.
      expect(fake.scrollToLine).toHaveBeenLastCalledWith(stillShown ? 3 : 4);
      blocks.dispose();
    },
  );

  it('releases subscriptions and passes keys through after idempotent disposal', () => {
    // Given: an attachment has installed subscriptions and a key handler.
    const blocks = attachCommandBlocks(terminal);
    const oldHandler = fake.handler;
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });

    // When: cleanup runs twice and an old callback is offered another key.
    blocks.dispose();
    blocks.dispose();
    const result = oldHandler(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true }));

    // Then: no retained callbacks or keys can affect the disposed attachment.
    expect(result).toBe(true);
    expect(press(fake, 'ArrowUp')).toBe(true);
    expect(fake.dataListener).toBeNull();
    expect(fake.bufferListener).toBeNull();
    expect(integrationMock.historyInstances[0]?.dispose).toHaveBeenCalledOnce();
  });
  it('clears only selection on Escape and continues navigation from the clamped command', () => {
    // Given: the latest selected command is below the viewport limit.
    fake.buffer.active.baseY = 10;
    fake.buffer.active.viewportY = 10;
    fake.buffer.active.cursorY = 15;
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    for (const line of [5, 15, 20]) {
      history?.emitCompleted({ id: `command-${line}`, blockStartMarker: { line } });
    }
    press(fake, 'ArrowUp');
    const highlight = integrationMock.createHighlight.mock.results[0]?.value;

    // When: Escape removes selection and a further previous shortcut is pressed.
    expect(press(fake, 'Escape', { metaKey: false })).toBe(false);
    expect(press(fake, 'c', { code: 'KeyC', shiftKey: true })).toBe(true);
    press(fake, 'ArrowUp');

    // Then: the hidden highlight is disposed and navigation continues from the previous id.
    expect(highlight?.dispose).toHaveBeenCalledOnce();
    expect(fake.scrollToLine).toHaveBeenLastCalledWith(15);
    expect(press(fake, 'c', { code: 'KeyC', shiftKey: true })).toBe(false);
    expect(integrationMock.copies[1]?.copy).toHaveBeenCalledWith('command-and-output');
    blocks.dispose();
  });

  it('copies the selected block after manual scrolling, then selects the next visible jump destination', () => {
    // Given: the latest command is selected.
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    for (const line of [5, 15, 20]) {
      history?.emitCompleted({ id: `command-${line}`, blockStartMarker: { line } });
    }
    press(fake, 'ArrowUp');

    // When: the viewport moves away and Option changes C into a different character.
    fake.scrollToLine(0);
    const copied = press(fake, 'ç', { code: 'KeyC', altKey: true });
    press(fake, 'ArrowDown');
    press(fake, 'C', { code: 'KeyC', shiftKey: true });

    // Then: copying retains the selected target, while a new jump uses the visible viewport.
    expect(copied).toBe(false);
    expect(integrationMock.copies[2]?.copy).toHaveBeenCalledWith('output');
    expect(integrationMock.copies[0]?.copy).toHaveBeenCalledWith('command-and-output');
    expect(integrationMock.createHighlight).toHaveBeenCalledTimes(2);
    blocks.dispose();
  });

  it.each(['input', 'alternate', 'removal', 'past-latest'] as const)(
    'clears the copy target after %s',
    (reason) => {
      // Given: a command has been selected through navigation.
      const blocks = attachCommandBlocks(terminal);
      const history = integrationMock.historyInstances[0];
      const entry = { id: 'only', blockStartMarker: { line: 5 } };
      history?.emitCompleted(entry);
      press(fake, 'ArrowUp');

      // When: selection is invalidated by normal lifecycle or input.
      if (reason === 'input') {
        fake.dataListener?.();
      }
      if (reason === 'alternate') {
        fake.bufferListener?.({ type: 'alternate' });
      }
      if (reason === 'removal') {
        history?.emitRemoved(entry);
      }
      if (reason === 'past-latest') {
        press(fake, 'ArrowDown');
      }

      // Then: copy keys and Escape return to their normal behavior.
      expect(press(fake, 'c', { code: 'KeyC', shiftKey: true })).toBe(true);
      expect(press(fake, 'Escape', { metaKey: false })).toBe(true);
      expect(integrationMock.copies[0]?.copy).not.toHaveBeenCalled();
      blocks.dispose();
    },
  );

  it.each([
    { ctrlKey: true, shiftKey: true },
    { altKey: true, shiftKey: true },
    {},
    { metaKey: false, shiftKey: true },
  ])('passes through unrelated copy modifier combinations %j', (modifiers) => {
    // Given: a completed command is selected.
    const blocks = attachCommandBlocks(terminal);
    integrationMock.historyInstances[0]?.emitCompleted({
      id: 'only',
      blockStartMarker: { line: 5 },
    });
    press(fake, 'ArrowUp');

    // When: an unassigned copy combination is offered.
    const result = press(fake, 'c', { code: 'KeyC', ...modifiers });

    // Then: standard Cmd+C and extra modifiers retain their existing behavior.
    expect(result).toBe(true);
    expect(integrationMock.copies[0]?.copy).not.toHaveBeenCalled();
    blocks.dispose();
  });
});
