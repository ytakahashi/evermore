import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalOutputFingerprint } from './command-output';
import { createTerminalCommandCopyDecoration } from './command-copy-decoration';
import type { TerminalCommandHistoryEntry } from './command-history';

class MockMarker implements IMarker {
  public readonly id = 1;
  public line = 0;
  public isDisposed = false;
  private readonly listeners = new Set<() => void>();

  public readonly onDispose = (listener: () => void): IDisposable => {
    this.listeners.add(listener);
    return {
      dispose: (): void => {
        this.listeners.delete(listener);
      },
    };
  };

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.line = -1;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

class MockDecoration implements IDecoration {
  public readonly marker: IMarker;
  public readonly options = {};
  public element: HTMLElement | undefined;
  public isDisposed = false;
  private readonly renderListeners = new Set<(element: HTMLElement) => void>();
  private readonly disposeListeners = new Set<() => void>();

  public constructor(marker: IMarker) {
    this.marker = marker;
  }

  public readonly onRender = (listener: (element: HTMLElement) => void): IDisposable => {
    this.renderListeners.add(listener);
    return {
      dispose: (): void => {
        this.renderListeners.delete(listener);
      },
    };
  };

  public readonly onDispose = (listener: () => void): IDisposable => {
    this.disposeListeners.add(listener);
    return {
      dispose: (): void => {
        this.disposeListeners.delete(listener);
      },
    };
  };

  public render(element: HTMLElement): void {
    this.element = element;
    for (const listener of [...this.renderListeners]) {
      listener(element);
    }
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const listener of [...this.disposeListeners]) {
      listener();
    }
  }
}

interface TerminalFixture {
  decoration: MockDecoration;
  emitResize: (cols: number) => void;
  registerDecoration: ReturnType<typeof vi.fn>;
  terminal: Terminal;
}

function createTerminalFixture(output = 'result'): TerminalFixture {
  const promptMarker = new MockMarker();
  const decoration = new MockDecoration(promptMarker);
  const lines = [
    {
      isWrapped: false,
      length: output.length,
      translateToString: (
        _trimRight?: boolean,
        startColumn = 0,
        endColumn = output.length,
      ): string => output.slice(startColumn, endColumn),
      getCell: () => undefined,
    },
    {
      isWrapped: false,
      length: 80,
      translateToString: () => '',
      getCell: () => undefined,
    },
  ];
  const normalBuffer = {
    type: 'normal' as const,
    cursorX: 0,
    cursorY: 0,
    viewportY: 0,
    baseY: 0,
    length: lines.length,
    getLine: (index: number) => lines[index],
    getNullCell: () => {
      throw new Error('getNullCell is not used by command copy decoration');
    },
  };
  const registerDecoration = vi.fn(() => decoration);
  let resizeListener: ((dimensions: { cols: number; rows: number }) => void) | null = null;
  const terminal = {
    cols: 80,
    buffer: {
      normal: normalBuffer,
    },
    onResize: (listener: (dimensions: { cols: number; rows: number }) => void) => {
      resizeListener = listener;
      return {
        dispose: (): void => {
          resizeListener = null;
        },
      };
    },
    registerDecoration,
  } as unknown as Terminal;

  return {
    decoration,
    emitResize: (cols: number): void => {
      resizeListener?.({ cols, rows: 24 });
    },
    registerDecoration,
    terminal,
  };
}

function createEntry(promptMarker: IMarker, output = 'result'): TerminalCommandHistoryEntry {
  return {
    id: 'terminal-command-1',
    command: 'echo result',
    promptMarker,
    outputStart: { marker: new MockMarker(), column: 0 },
    outputEnd: { marker: Object.assign(new MockMarker(), { line: 1 }), column: 0 },
    outputFingerprint: createTerminalOutputFingerprint(output),
    completionCols: 80,
    endsAtLineStart: true,
  };
}

function renderButton(decoration: MockDecoration): HTMLButtonElement {
  const element = document.createElement('div');
  decoration.render(element);
  const button = element.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected command copy button to render');
  }
  return button;
}

describe('createTerminalCommandCopyDecoration', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers a right-anchored top-layer decoration on the prompt marker', () => {
    // Given: a completed command entry.
    const fixture = createTerminalFixture();
    const entry = createEntry(fixture.decoration.marker);

    // When: its copy decoration is created.
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry,
    });

    // Then: xterm receives the initial compact right-edge placement.
    expect(disposable).not.toBeNull();
    expect(fixture.registerDecoration).toHaveBeenCalledWith({
      marker: entry.promptMarker,
      anchor: 'right',
      width: 2,
      height: 1,
      layer: 'top',
    });
  });

  it('returns null when xterm cannot register the decoration', () => {
    // Given: xterm rejects a disposed or alternate-buffer marker.
    const fixture = createTerminalFixture();
    fixture.registerDecoration.mockReturnValue(undefined);

    // When: decoration creation is attempted.
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
    });

    // Then: the caller receives no lifecycle handle.
    expect(disposable).toBeNull();
  });

  it('renders one semantic button across repeated decoration renders', () => {
    // Given: a registered command decoration.
    const fixture = createTerminalFixture();
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
    });
    const element = document.createElement('div');

    // When: xterm renders the same decoration element more than once.
    fixture.decoration.render(element);
    fixture.decoration.render(element);

    // Then: one keyboard-operable button is retained.
    const buttons = element.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.type).toBe('button');
    expect(buttons[0]?.tabIndex).toBe(0);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Copy command and output');
    expect(element).toHaveClass('evermore-command-copy-decoration');
    disposable?.dispose();
  });

  it('copies the current verified command output and shows temporary success state', async () => {
    // Given: current buffer output matches the completion fingerprint.
    vi.useFakeTimers();
    const fixture = createTerminalFixture();
    const writeClipboardText = vi.fn(() => Promise.resolve());
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
      writeClipboardText,
    });
    const button = renderButton(fixture.decoration);

    // When: the user clicks the command copy button.
    button.click();
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
    });

    // Then: verified text is copied and success feedback resets after 1.5 seconds.
    expect(writeClipboardText).toHaveBeenCalledWith('$ echo result\nresult');
    expect(button.dataset.state).toBe('copied');
    expect(button.textContent).toBe('✓');
    await vi.advanceTimersByTimeAsync(1500);
    expect(button.dataset.state).toBe('idle');
    expect(button.textContent).toBe('⧉');
    disposable?.dispose();
  });

  it('shows an error without writing when the buffer no longer matches the fingerprint', () => {
    // Given: the entry fingerprint refers to different completion-time output.
    const fixture = createTerminalFixture('changed');
    const writeClipboardText = vi.fn(() => Promise.resolve());
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker, 'original'),
      writeClipboardText,
    });
    const button = renderButton(fixture.decoration);

    // When: the user tries to copy stale buffer content.
    button.click();

    // Then: no partial text is written and the visible button reports failure.
    expect(writeClipboardText).not.toHaveBeenCalled();
    expect(button.dataset.state).toBe('error');
    expect(button.getAttribute('aria-label')).toBe('Copy command and output failed');
    expect(button.textContent).toBe('!');
    disposable?.dispose();
  });

  it('shows an error when clipboard writing is rejected', async () => {
    // Given: the browser clipboard rejects the explicit write.
    const fixture = createTerminalFixture();
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
      writeClipboardText: () => Promise.reject(new Error('denied')),
    });
    const button = renderButton(fixture.decoration);

    // When: copy is attempted.
    button.click();
    await vi.waitFor(() => {
      expect(button.dataset.state).toBe('error');
    });

    // Then: the button is enabled for a later retry.
    expect(button.disabled).toBe(false);
    disposable?.dispose();
  });

  it('prevents concurrent clipboard writes while one copy is pending', async () => {
    // Given: the first clipboard write remains pending.
    const fixture = createTerminalFixture();
    let resolveWrite!: () => void;
    const writeClipboardText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
      writeClipboardText,
    });
    const button = renderButton(fixture.decoration);

    // When: repeated activation occurs before the first write settles.
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Then: only one clipboard write is in flight.
    expect(writeClipboardText).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    resolveWrite();
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
    });
    disposable?.dispose();
  });

  it('disposes non-newline-terminated output decoration after a column resize', () => {
    // Given: a command completed mid-line, where Phase 0 found reflow cannot preserve the column.
    const fixture = createTerminalFixture();
    const entry = {
      ...createEntry(fixture.decoration.marker),
      endsAtLineStart: false,
    };
    createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry,
    });
    const button = renderButton(fixture.decoration);

    // When: terminal columns change from the completion width.
    fixture.emitResize(79);

    // Then: the potentially inaccurate command is no longer offered for copying.
    expect(fixture.decoration.isDisposed).toBe(true);
    expect(button.parentElement).toBeNull();
  });

  it('keeps newline-terminated output decoration across column resizes', () => {
    // Given: a command ended at column zero and can be reconstructed after reflow.
    const fixture = createTerminalFixture();
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
    });
    const button = renderButton(fixture.decoration);

    // When: terminal columns change.
    fixture.emitResize(40);

    // Then: the marker-backed copy action remains available.
    expect(fixture.decoration.isDisposed).toBe(false);
    expect(button.parentElement).not.toBeNull();
    disposable?.dispose();
  });

  it('cleans up the button, feedback timer, and decoration idempotently', async () => {
    // Given: a copied decoration has an active feedback timer.
    vi.useFakeTimers();
    const fixture = createTerminalFixture();
    const disposable = createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
      writeClipboardText: () => Promise.resolve(),
    });
    const button = renderButton(fixture.decoration);
    button.click();
    await vi.runAllTicks();
    expect(vi.getTimerCount()).toBe(1);

    // When: the owning history entry disposes the decoration twice.
    disposable?.dispose();
    disposable?.dispose();

    // Then: all owned UI resources are removed without a late timer update.
    expect(fixture.decoration.isDisposed).toBe(true);
    expect(button.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up owned UI when xterm disposes the decoration through marker lifecycle', () => {
    // Given: a rendered copy decoration.
    const fixture = createTerminalFixture();
    createTerminalCommandCopyDecoration({
      terminal: fixture.terminal,
      entry: createEntry(fixture.decoration.marker),
    });
    const button = renderButton(fixture.decoration);

    // When: xterm disposes the decoration after its marker is trimmed or cleared.
    fixture.decoration.dispose();

    // Then: the controller removes its button and listeners.
    expect(button.isConnected).toBe(false);
  });
});
