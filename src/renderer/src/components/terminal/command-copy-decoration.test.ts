import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalCommandCopyDecoration } from './command-copy-decoration';
import type { TerminalCommandCopyController, TerminalCommandCopyState } from './command-copy';
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
    // Snapshot: listeners may unsubscribe themselves while being notified.
    for (const listener of Array.from(this.listeners)) {
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
    for (const listener of Array.from(this.renderListeners)) {
      listener(element);
    }
  }

  public dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const listener of Array.from(this.disposeListeners)) {
      listener();
    }
  }
}

class FakeCopyController {
  private state: TerminalCommandCopyState = {
    status: 'idle',
    mode: 'command-and-output',
    busy: false,
    outputAvailable: true,
  };
  private readonly listeners = new Set<() => void>();
  public readonly copy = vi.fn(() => Promise.resolve());
  public readonly dispose = vi.fn();
  public readonly getState = (): TerminalCommandCopyState => this.state;
  public readonly onStateChange = (listener: () => void): IDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };
  public change(state: Partial<TerminalCommandCopyState>): void {
    this.state = { ...this.state, ...state };
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const handles: IDisposable[] = [];

function fixture(promptLine = 0): {
  controller: FakeCopyController;
  entry: TerminalCommandHistoryEntry;
  terminal: Terminal;
  decorations: MockDecoration[];
  registerDecoration: ReturnType<
    typeof vi.fn<(options: { marker: IMarker }) => MockDecoration | undefined>
  >;
  onDisposed: ReturnType<typeof vi.fn>;
  attach: () => IDisposable | null;
} {
  const blockStartMarker = new MockMarker();
  const promptMarker = Object.assign(new MockMarker(), { line: promptLine });
  const entry: TerminalCommandHistoryEntry = {
    id: 'command',
    command: 'echo result',
    blockStartMarker,
    promptMarker,
    outputStart: { marker: promptMarker, column: 0 },
    outputEnd: { marker: Object.assign(new MockMarker(), { line: promptLine + 2 }), column: 0 },
    outputFingerprint: { length: 6, hash: '00000000' },
    completionCols: 80,
    endsAtLineStart: true,
  };
  const decorations: MockDecoration[] = [];
  const registerDecoration = vi.fn<(options: { marker: IMarker }) => MockDecoration | undefined>(
    (options) => {
      const value = new MockDecoration(options.marker);
      decorations.push(value);
      return value;
    },
  );
  const terminal = { registerDecoration } as unknown as Terminal;
  const controller = new FakeCopyController();
  const onDisposed = vi.fn();
  return {
    entry,
    terminal,
    controller,
    decorations,
    registerDecoration,
    onDisposed,
    attach: () => {
      const handle = createTerminalCommandCopyDecoration({
        terminal,
        entry,
        copyController: controller as unknown as TerminalCommandCopyController,
        onDisposed,
      });
      if (handle) {
        handles.push(handle);
      }
      return handle;
    },
  };
}

function renderButton(decoration: MockDecoration): HTMLButtonElement {
  const element = document.createElement('div');
  decoration.render(element);
  const button = element.querySelector('button');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Expected copy button');
  }
  return button;
}

function decorationAt(decorations: MockDecoration[], index: number): MockDecoration {
  const value = decorations[index];
  if (!value) {
    throw new Error('Expected registered decoration');
  }
  return value;
}

describe('createTerminalCommandCopyDecoration', () => {
  afterEach(() => {
    for (const handle of handles.splice(0)) {
      handle.dispose();
    }
  });

  it('registers the action at the prompt and retains one semantic button across renders', () => {
    // Given: a multi-line prompt with an independently owned copy controller.
    const f = fixture(1);
    f.attach();
    const decoration = decorationAt(f.decorations, 0);
    const element = document.createElement('div');

    // When: xterm renders the same container repeatedly.
    decoration.render(element);
    decoration.render(element);

    // Then: placement and accessible action are stable.
    expect(f.registerDecoration).toHaveBeenCalledExactlyOnceWith({
      marker: f.entry.promptMarker,
      anchor: 'right',
      width: 2,
      height: 1,
      layer: 'top',
    });
    expect(element).toHaveClass('evermore-command-copy-decoration');
    expect(element.querySelectorAll('button')).toHaveLength(1);
    expect(element.querySelector('button')).toHaveAttribute(
      'aria-label',
      'Copy command and output',
    );
    expect(element.querySelector('button')).toHaveAttribute('type', 'button');
    expect(element.querySelector('button')).toHaveAttribute('tabindex', '0');
  });

  it('delegates button activation and reflects busy state without owning copy execution', () => {
    // Given: a rendered copy action.
    const f = fixture();
    f.attach();
    const button = renderButton(decorationAt(f.decorations, 0));
    const bubbled = vi.fn();
    button.parentElement?.addEventListener('mousedown', bubbled);

    // When: the action is clicked and its owner reports a pending write.
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button.click();
    f.controller.change({ busy: true });
    button.click();

    // Then: one action request is delegated, terminal pointer handling is suppressed, and busy disables it.
    expect(f.controller.copy).toHaveBeenCalledExactlyOnceWith('command-and-output');
    expect(bubbled).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    f.controller.change({ busy: false });
    expect(button.disabled).toBe(false);
  });

  it.each([
    { mode: 'output', status: 'copied', label: 'Copied output', symbol: '✓' },
    { mode: 'output', status: 'error', label: 'Copy output failed', symbol: '!' },
    { mode: 'command', status: 'copied', label: 'Copied command', symbol: '✓' },
    { mode: 'command', status: 'error', label: 'Copy command failed', symbol: '!' },
    {
      mode: 'command-and-output',
      status: 'copied',
      label: 'Copied command and output',
      symbol: '✓',
    },
    {
      mode: 'command-and-output',
      status: 'error',
      label: 'Copy command and output failed',
      symbol: '!',
    },
  ] as const)(
    'shows $mode / $status only in the independent indicator',
    ({ mode, status, label, symbol }) => {
      // Given: the action and block start occupy different prompt rows.
      const f = fixture(1);
      f.attach();
      const button = renderButton(decorationAt(f.decorations, 0));

      // When: the shared owner reports a keyboard or button result.
      f.controller.change({ mode, status });
      const indicator = decorationAt(f.decorations, 1);
      const element = document.createElement('div');
      indicator.render(element);

      // Then: feedback describes the actual copy and the action continues to describe its next operation.
      expect(f.registerDecoration).toHaveBeenLastCalledWith({
        marker: f.entry.blockStartMarker,
        anchor: 'right',
        width: 2,
        height: 1,
        layer: 'top',
      });
      expect(element).toHaveClass('evermore-command-copy-feedback-decoration');
      expect(element.querySelector('[role="status"]')).toHaveTextContent(symbol);
      expect(element.querySelector('[role="status"]')).toHaveAttribute('aria-label', label);
      expect(button.textContent).toBe('⧉');
      expect(button).toHaveAttribute('aria-label', 'Copy command and output');
      expect(button.hidden).toBe(false);
    },
  );

  it('restores presentation from shared state after DOM replacement and removes idle feedback', () => {
    // Given: same-line prompt feedback occupies the action's cell.
    const f = fixture();
    f.attach();
    const action = decorationAt(f.decorations, 0);
    const original = renderButton(action);
    f.controller.change({ status: 'copied', mode: 'output' });
    expect(original.hidden).toBe(true);
    const indicator = decorationAt(f.decorations, 1);
    const originalContainer = document.createElement('div');
    indicator.render(originalContainer);

    // When: xterm replaces both DOM containers before the owner clears feedback.
    const replacement = renderButton(action);
    const replacementContainer = document.createElement('div');
    indicator.render(replacementContainer);
    expect(replacement.hidden).toBe(true);
    expect(replacementContainer.querySelector('[role="status"]')).toHaveAttribute(
      'aria-label',
      'Copied output',
    );
    original.dispatchEvent(new MouseEvent('click'));
    f.controller.change({ status: 'idle' });

    // Then: detached actions have no listeners, and the controller's idle notification alone restores the action.
    expect(f.controller.copy).not.toHaveBeenCalled();
    expect(original.parentElement).toBeNull();
    expect(originalContainer.childElementCount).toBe(0);
    expect(replacement.hidden).toBe(false);
    expect(replacementContainer.childElementCount).toBe(0);
    expect(indicator.isDisposed).toBe(true);
  });

  it('keeps feedback alive when output invalidation removes the action', () => {
    // Given: an independently owned copy controller and rendered action.
    const f = fixture();
    const visual = f.attach();
    const action = decorationAt(f.decorations, 0);
    const button = renderButton(action);

    // When: the owner invalidates output after reflow, then reports a rejected keyboard copy.
    f.controller.change({ outputAvailable: false });
    f.controller.change({ status: 'error', mode: 'output' });
    const element = document.createElement('div');
    decorationAt(f.decorations, 1).render(element);

    // Then: only the action is removed; feedback and controller lifetime remain independent.
    expect(action.isDisposed).toBe(true);
    expect(button.parentElement).toBeNull();
    expect(f.onDisposed).not.toHaveBeenCalled();
    expect(element.querySelector('[role="status"]')).toHaveAttribute(
      'aria-label',
      'Copy output failed',
    );
    visual?.dispose();
    expect(f.controller.dispose).not.toHaveBeenCalled();
  });

  it.each(['initially-invalid', 'registration-failed'] as const)(
    'can show feedback without an action: %s',
    (reason) => {
      // Given: output is unavailable or xterm temporarily cannot register the action.
      const f = fixture();
      if (reason === 'initially-invalid') {
        f.controller.change({ outputAvailable: false });
      } else {
        f.registerDecoration.mockReturnValueOnce(undefined);
      }

      // When: the view attaches and the copy owner reports an error.
      expect(f.attach()).not.toBeNull();
      f.controller.change({ status: 'error', mode: 'output' });
      const element = document.createElement('div');
      decorationAt(f.decorations, 0).render(element);

      // Then: feedback uses an independent block-start decoration.
      expect(element.querySelector('[role="status"]')).toHaveTextContent('!');
    },
  );

  it('rejects disposed history markers', () => {
    // Given: history has already lost its block-start marker.
    const f = fixture();
    f.entry.blockStartMarker.dispose();

    // When: attachment attempts to create a view.
    const handle = f.attach();

    // Then: no decoration or copy ownership is acquired.
    expect(handle).toBeNull();
    expect(f.registerDecoration).not.toHaveBeenCalled();
    expect(f.controller.dispose).not.toHaveBeenCalled();
  });

  it.each(['owner', 'xterm'] as const)(
    'disposes presentation and subscriptions independently: %s',
    (source) => {
      // Given: rendered action and feedback with an externally owned copy controller.
      const f = fixture(1);
      const visual = f.attach();
      const action = decorationAt(f.decorations, 0);
      const button = renderButton(action);
      f.controller.change({ status: 'copied' });
      const indicator = decorationAt(f.decorations, 1);
      const element = document.createElement('div');
      indicator.render(element);

      // When: the view is disposed directly or through xterm's marker lifecycle, then state changes again.
      if (source === 'xterm') {
        action.dispose();
      }
      visual?.dispose();
      visual?.dispose();
      f.controller.change({ status: 'error' });
      button.dispatchEvent(new MouseEvent('click'));

      // Then: no UI or listener is revived and the view never disposes the shared owner.
      expect(action.isDisposed).toBe(true);
      expect(indicator.isDisposed).toBe(true);
      expect(button.parentElement).toBeNull();
      expect(element.childElementCount).toBe(0);
      expect(f.onDisposed).toHaveBeenCalledOnce();
      expect(f.controller.copy).not.toHaveBeenCalled();
      expect(f.controller.dispose).not.toHaveBeenCalled();
      expect(f.registerDecoration).toHaveBeenCalledTimes(2);
    },
  );
});
