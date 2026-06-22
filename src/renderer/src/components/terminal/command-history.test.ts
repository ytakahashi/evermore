import type { IBuffer, IBufferLine, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { describe, expect, it, vi } from 'vitest';
import { encodeOsc633CommandLine } from '../../../../shared/shell-integration/osc633-encode';
import { TerminalCommandHistory, type TerminalCommandHistoryEntry } from './command-history';

class MockDisposable implements IDisposable {
  public readonly dispose = vi.fn();
}

class MockMarker implements IMarker {
  public readonly id: number;
  public line: number;
  public isDisposed = false;
  private readonly disposeListeners = new Set<() => void>();

  public constructor(id: number, line: number) {
    this.id = id;
    this.line = line;
  }

  public readonly onDispose = (listener: () => void): IDisposable => {
    this.disposeListeners.add(listener);
    return {
      dispose: (): void => {
        this.disposeListeners.delete(listener);
      },
    };
  };

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.line = -1;
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }
}

class MockTerminal {
  public readonly cols = 80;
  private readonly emptyLine: IBufferLine = {
    isWrapped: false,
    length: 80,
    getCell: () => undefined,
    translateToString: () => '',
  };
  private readonly normalBuffer = {
    type: 'normal' as const,
    cursorX: 0,
    cursorY: 0,
    viewportY: 0,
    baseY: 0,
    length: 100,
    getLine: (index: number): IBufferLine | undefined =>
      index >= 0 && index < 100 ? this.emptyLine : undefined,
    getNullCell: () => {
      throw new Error('getNullCell is not used by command history');
    },
  };
  public readonly parser = {
    registerOscHandler: vi.fn(
      (ident: number, handler: (data: string) => boolean | Promise<boolean>) => {
        this.oscHandlers.set(ident, handler);
        return this.trackDisposable();
      },
    ),
  };
  public readonly buffer = {
    active: this.normalBuffer as IBuffer,
    normal: this.normalBuffer as IBuffer,
    onBufferChange: (listener: (buffer: Pick<IBuffer, 'type'>) => void): IDisposable => {
      this.bufferChangeListener = listener;
      return this.trackDisposable();
    },
  };
  public readonly registerMarker = vi.fn(() => {
    const marker = new MockMarker(++this.nextMarkerId, this.nextMarkerId);
    this.markers.push(marker);
    return marker;
  });
  public readonly onWriteParsed = (listener: () => void): IDisposable => {
    this.writeParsedListener = listener;
    return this.trackDisposable();
  };
  public readonly disposables: MockDisposable[] = [];
  public readonly markers: MockMarker[] = [];
  private readonly oscHandlers = new Map<number, (data: string) => boolean | Promise<boolean>>();
  private bufferChangeListener: ((buffer: Pick<IBuffer, 'type'>) => void) | null = null;
  private nextMarkerId = 0;
  private writeParsedListener: (() => void) | null = null;

  public emitOsc(ident: number, data: string): void {
    void this.oscHandlers.get(ident)?.(data);
  }

  public emitWriteParsed(): void {
    this.writeParsedListener?.();
  }

  public setBuffer(type: 'alternate' | 'normal'): void {
    this.buffer.active = {
      ...this.normalBuffer,
      type,
    };
    this.bufferChangeListener?.({ type });
  }

  public setCursorX(cursorX: number): void {
    this.normalBuffer.cursorX = cursorX;
    if (this.buffer.active.type === 'normal') {
      this.buffer.active = this.normalBuffer;
    }
  }

  private trackDisposable(): MockDisposable {
    const disposable = new MockDisposable();
    this.disposables.push(disposable);
    return disposable;
  }
}

function asTerminal(terminal: MockTerminal): Terminal {
  return terminal as unknown as Terminal;
}

function emitCompletedCommand(
  terminal: MockTerminal,
  command: string,
  options: { endColumn?: number; startColumn?: number } = {},
): void {
  terminal.emitOsc(133, 'B');
  terminal.emitOsc(633, `E;${encodeOsc633CommandLine(command)}`);
  terminal.setCursorX(options.startColumn ?? 0);
  terminal.emitOsc(133, 'C');
  terminal.setCursorX(options.endColumn ?? 0);
  terminal.emitOsc(133, 'D;0');
  terminal.emitWriteParsed();
}

describe('TerminalCommandHistory', () => {
  it('publishes independent completed entries after each write is parsed', () => {
    // Given: a history controller observing a normal xterm buffer.
    const terminal = new MockTerminal();
    const onCommandCompleted = vi.fn<(entry: TerminalCommandHistoryEntry) => void>();
    const history = new TerminalCommandHistory({
      terminal: asTerminal(terminal),
      onCommandCompleted,
    });

    // When: two valid shell command cycles complete.
    emitCompletedCommand(terminal, 'echo one');
    emitCompletedCommand(terminal, 'printf two', { endColumn: 3 });

    // Then: both decoded commands retain independent boundary markers and newline metadata.
    const entries = history.getCompletedCommands();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.command)).toEqual(['echo one', 'printf two']);
    expect(entries[0]?.endsAtLineStart).toBe(true);
    expect(entries[1]?.endsAtLineStart).toBe(false);
    expect(entries[0]?.outputFingerprint).toEqual({
      length: 0,
      hash: '811c9dc5',
    });
    expect(entries[0]?.completionCols).toBe(80);
    expect(entries[0]?.id).not.toBe(entries[1]?.id);
    expect(onCommandCompleted).toHaveBeenCalledTimes(2);
  });

  it('does not expose a command until OSC 133;D is followed by onWriteParsed', () => {
    // Given: a valid command has started.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo pending');
    terminal.emitOsc(133, 'C');

    // When: the finish marker arrives but the containing terminal write is not parsed yet.
    terminal.emitOsc(133, 'D;0');

    // Then: the command remains pending until xterm commits the write.
    expect(history.getCompletedCommands()).toEqual([]);
    terminal.emitWriteParsed();
    expect(history.getCompletedCommands()).toHaveLength(1);
  });

  it('does not expose a running command when a write is parsed before OSC 133;D', () => {
    // Given: a valid command has reached the running state.
    const terminal = new MockTerminal();
    const onCommandCompleted = vi.fn<(entry: TerminalCommandHistoryEntry) => void>();
    const history = new TerminalCommandHistory({
      terminal: asTerminal(terminal),
      onCommandCompleted,
    });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo running');
    terminal.emitOsc(133, 'C');

    // When: xterm finishes parsing an output write before the command-finished marker arrives.
    terminal.emitWriteParsed();

    // Then: running command metadata remains private until a later OSC 133;D is parsed.
    expect(history.getCompletedCommands()).toEqual([]);
    expect(onCommandCompleted).not.toHaveBeenCalled();
  });

  it('finalizes a command when the next prompt begins in the same parsed write', () => {
    // Given: a command finish and next prompt marker can share one xterm write.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo batched');
    terminal.emitOsc(133, 'C');

    // When: OSC 133;D and the next OSC 133;B arrive before onWriteParsed.
    terminal.emitOsc(133, 'D;0');
    terminal.emitOsc(133, 'A');
    terminal.emitOsc(133, 'B');
    terminal.emitWriteParsed();

    // Then: the completed command is preserved while the next prompt cycle remains active.
    expect(history.getCompletedCommands().map((entry) => entry.command)).toEqual(['echo batched']);
  });

  it('finalizes multiple complete command cycles delivered in one parsed write', () => {
    // Given: xterm can batch several short command cycles into one write callback.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });

    // When: two complete cycles arrive before onWriteParsed.
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo one');
    terminal.emitOsc(133, 'C');
    terminal.emitOsc(133, 'D;0');
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo two');
    terminal.emitOsc(133, 'C');
    terminal.emitOsc(133, 'D;0');
    terminal.emitOsc(133, 'B');
    terminal.emitWriteParsed();

    // Then: the pending queue publishes both commands in stream order.
    expect(history.getCompletedCommands().map((entry) => entry.command)).toEqual([
      'echo one',
      'echo two',
    ]);
  });

  it.each([
    {
      name: 'missing prompt',
      emit: (terminal: MockTerminal): void => {
        terminal.emitOsc(633, 'E;echo invalid');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'D;0');
      },
    },
    {
      name: 'missing command line',
      emit: (terminal: MockTerminal): void => {
        terminal.emitOsc(133, 'B');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'D;0');
      },
    },
    {
      name: 'duplicate command line',
      emit: (terminal: MockTerminal): void => {
        terminal.emitOsc(133, 'B');
        terminal.emitOsc(633, 'E;echo first');
        terminal.emitOsc(633, 'E;echo second');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'D;0');
      },
    },
    {
      name: 'duplicate command start',
      emit: (terminal: MockTerminal): void => {
        terminal.emitOsc(133, 'B');
        terminal.emitOsc(633, 'E;echo invalid');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'D;0');
      },
    },
    {
      name: 'malformed command line',
      emit: (terminal: MockTerminal): void => {
        terminal.emitOsc(133, 'B');
        terminal.emitOsc(633, 'E;\\q');
        terminal.emitOsc(133, 'C');
        terminal.emitOsc(133, 'D;0');
      },
    },
  ])('drops an invalid cycle with $name', ({ emit }) => {
    // Given: a fresh history controller.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });

    // When: an invalid OSC ordering or payload is observed.
    emit(terminal);
    terminal.emitWriteParsed();

    // Then: no partial command is published.
    expect(history.getCompletedCommands()).toEqual([]);
  });

  it('recovers on the next valid prompt cycle after malformed OSC input', () => {
    // Given: an invalid command cycle was discarded.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;first');
    terminal.emitOsc(633, 'E;duplicate');
    terminal.emitOsc(133, 'C');
    terminal.emitOsc(133, 'D;0');
    terminal.emitWriteParsed();

    // When: the next prompt begins a valid command cycle.
    emitCompletedCommand(terminal, 'echo recovered');

    // Then: tracking resumes without retaining the malformed candidate.
    expect(history.getCompletedCommands().map((entry) => entry.command)).toEqual([
      'echo recovered',
    ]);
  });

  it('discards a running command that enters the alternate buffer', () => {
    // Given: a command is running in the normal buffer.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;less file');
    terminal.emitOsc(133, 'C');

    // When: the command activates and later leaves the alternate buffer before finishing.
    terminal.setBuffer('alternate');
    terminal.setBuffer('normal');
    terminal.emitOsc(133, 'D;0');
    terminal.emitWriteParsed();

    // Then: the full-screen command is not exposed as copyable history.
    expect(history.getCompletedCommands()).toEqual([]);
  });

  it('removes a completed entry when any boundary marker is disposed', () => {
    // Given: a completed command and a removal observer.
    const terminal = new MockTerminal();
    const onCommandRemoved = vi.fn<(entry: TerminalCommandHistoryEntry) => void>();
    const history = new TerminalCommandHistory({
      terminal: asTerminal(terminal),
      onCommandRemoved,
    });
    emitCompletedCommand(terminal, 'echo trimmed');
    const entry = history.getCompletedCommands()[0];

    // When: scrollback trim or clear disposes one boundary marker.
    entry?.outputStart.marker.dispose();

    // Then: the whole history entry and its remaining markers are removed.
    expect(history.getCompletedCommands()).toEqual([]);
    expect(entry?.promptMarker.isDisposed).toBe(true);
    expect(entry?.outputEnd.marker.isDisposed).toBe(true);
    expect(onCommandRemoved).toHaveBeenCalledWith(entry);
  });

  it('drops a pending command if a marker is disposed before onWriteParsed', () => {
    // Given: OSC 133;D has queued a command for write completion.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo cleared');
    terminal.emitOsc(133, 'C');
    terminal.emitOsc(133, 'D;0');

    // When: clear disposes its start marker before xterm reports the write as parsed.
    terminal.markers[1]?.dispose();
    terminal.emitWriteParsed();

    // Then: the incomplete command is never published.
    expect(history.getCompletedCommands()).toEqual([]);
  });

  it('keeps completed history until the controller is disposed', () => {
    // Given: a completed command remains after the PTY could have exited.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    emitCompletedCommand(terminal, 'echo retained');
    const entry = history.getCompletedCommands()[0];

    // When: no terminal/controller cleanup occurs.

    // Then: the history and markers remain available independently of PTY runtime state.
    expect(history.getCompletedCommands()).toHaveLength(1);
    expect(entry?.promptMarker.isDisposed).toBe(false);
  });

  it('disposes handlers and all command markers with terminal lifecycle cleanup', () => {
    // Given: completed, pending, and active command metadata exist.
    const terminal = new MockTerminal();
    const history = new TerminalCommandHistory({ terminal: asTerminal(terminal) });
    emitCompletedCommand(terminal, 'echo complete');
    terminal.emitOsc(133, 'B');
    terminal.emitOsc(633, 'E;echo pending');
    terminal.emitOsc(133, 'C');
    terminal.emitOsc(133, 'D;0');
    terminal.emitOsc(133, 'B');

    // When: the owning terminal disposes its history controller.
    history.dispose();
    history.dispose();

    // Then: every marker is released and completed metadata is cleared idempotently.
    expect(history.getCompletedCommands()).toEqual([]);
    expect(terminal.markers.every((marker) => marker.isDisposed)).toBe(true);
    expect(terminal.disposables).toHaveLength(4);
    expect(
      terminal.disposables.every((disposable) => disposable.dispose.mock.calls.length === 1),
    ).toBe(true);
  });
});
