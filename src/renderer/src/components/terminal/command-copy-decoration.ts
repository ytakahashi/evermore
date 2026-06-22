import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import { createTerminalCommandCopyText } from './command-output';
import type { TerminalCommandHistoryEntry } from './command-history';

const COPY_FEEDBACK_DURATION_MS = 1500;

type CopyState = 'copied' | 'error' | 'idle';
type SetTimeout = (
  callback: () => void,
  delayMs: number,
) => ReturnType<typeof globalThis.setTimeout>;
type ClearTimeout = (timer: ReturnType<typeof globalThis.setTimeout>) => void;

export interface TerminalCommandCopyDecorationOptions {
  terminal: Terminal;
  entry: TerminalCommandHistoryEntry;
  writeClipboardText?: (text: string) => Promise<void>;
  setTimeoutFn?: SetTimeout;
  clearTimeoutFn?: ClearTimeout;
  onDisposed?: () => void;
}

/**
 * Registers a command-copy button on an xterm decoration anchored to a completed command.
 *
 * Returns `null` when xterm cannot create the decoration, for example when the prompt marker was
 * already disposed. The caller owns the returned disposable and should release it when the
 * history entry is removed.
 */
export function createTerminalCommandCopyDecoration(
  options: TerminalCommandCopyDecorationOptions,
): IDisposable | null {
  const decoration = options.terminal.registerDecoration({
    marker: options.entry.promptMarker,
    anchor: 'right',
    width: 2,
    height: 1,
    layer: 'top',
  });
  if (!decoration) {
    return null;
  }

  return new CommandCopyDecorationController(options, decoration);
}

class CommandCopyDecorationController implements IDisposable {
  private readonly terminal: Terminal;
  private readonly entry: TerminalCommandHistoryEntry;
  private readonly decoration: IDecoration;
  private readonly writeClipboardText: (text: string) => Promise<void>;
  private readonly setTimeoutFn: SetTimeout;
  private readonly clearTimeoutFn: ClearTimeout;
  private readonly onDisposed: (() => void) | undefined;
  private readonly renderDisposable: IDisposable;
  private readonly decorationDisposeDisposable: IDisposable;
  private readonly resizeDisposable: IDisposable | null;
  private button: HTMLButtonElement | null = null;
  private feedbackTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private copyInProgress = false;
  private disposed = false;

  public constructor(options: TerminalCommandCopyDecorationOptions, decoration: IDecoration) {
    this.terminal = options.terminal;
    this.entry = options.entry;
    this.decoration = decoration;
    this.writeClipboardText = options.writeClipboardText ?? writeClipboardText;
    // Chromium timer functions require the Window receiver. Retaining the raw functions and later
    // invoking them as controller methods throws `Illegal invocation` after clipboard success.
    this.setTimeoutFn =
      options.setTimeoutFn ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => globalThis.clearTimeout(timer));
    this.onDisposed = options.onDisposed;
    this.renderDisposable = decoration.onRender((element) => {
      this.renderButton(element);
    });
    this.decorationDisposeDisposable = decoration.onDispose(() => {
      this.disposeOwnedResources();
    });
    // Only non-newline-terminated output loses its end column when reflow moves the cursor line.
    // Newline-terminated commands stay reconstructible across resizes, so they need no listener.
    this.resizeDisposable = this.entry.endsAtLineStart
      ? null
      : this.terminal.onResize(({ cols }) => {
          if (cols !== this.entry.completionCols) {
            this.dispose();
          }
        });
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposeOwnedResources();
    if (!this.decoration.isDisposed) {
      this.decoration.dispose();
    }
  }

  private renderButton(element: HTMLElement): void {
    if (this.disposed) {
      return;
    }

    element.classList.add('evermore-command-copy-decoration');
    if (this.button?.parentElement === element) {
      return;
    }

    this.removeButton();
    const button = element.ownerDocument.createElement('button');
    button.className = 'evermore-command-copy-button';
    button.type = 'button';
    button.tabIndex = 0;
    button.addEventListener('mousedown', stopTerminalPointerEvent);
    button.addEventListener('click', this.copyCommand);
    this.button = button;
    this.updateButtonState('idle');
    element.appendChild(button);
  }

  private readonly copyCommand = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.disposed || this.copyInProgress) {
      return;
    }
    this.clearFeedbackTimer();

    const text = createTerminalCommandCopyText(this.terminal.buffer.normal, this.entry);
    if (text === null) {
      this.updateButtonState('error');
      return;
    }

    this.copyInProgress = true;
    if (this.button) {
      this.button.disabled = true;
    }

    void this.writeClipboardText(text)
      .then(() => {
        if (!this.disposed) {
          this.updateButtonState('copied');
          this.scheduleIdleReset();
        }
      })
      .catch((_error: unknown) => {
        // Clipboard access depends on browser permissions and environment state. The decoration's
        // visible error state is the recovery path; the user can retry the same explicit action.
        if (!this.disposed) {
          this.updateButtonState('error');
        }
      })
      .finally(() => {
        this.copyInProgress = false;
        if (!this.disposed && this.button) {
          this.button.disabled = false;
        }
      });
  };

  private updateButtonState(state: CopyState): void {
    if (!this.button) {
      return;
    }

    const presentation = getCopyStatePresentation(state);
    this.button.dataset.state = state;
    this.button.setAttribute('aria-label', presentation.label);
    this.button.title = presentation.label;
    this.button.textContent = presentation.symbol;
  }

  private scheduleIdleReset(): void {
    this.clearFeedbackTimer();
    this.feedbackTimer = this.setTimeoutFn(() => {
      this.feedbackTimer = null;
      if (!this.disposed) {
        this.updateButtonState('idle');
      }
    }, COPY_FEEDBACK_DURATION_MS);
  }

  private clearFeedbackTimer(): void {
    if (this.feedbackTimer !== null) {
      this.clearTimeoutFn(this.feedbackTimer);
      this.feedbackTimer = null;
    }
  }

  private disposeOwnedResources(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearFeedbackTimer();
    this.renderDisposable.dispose();
    this.decorationDisposeDisposable.dispose();
    this.resizeDisposable?.dispose();
    this.removeButton();
    this.onDisposed?.();
  }

  private removeButton(): void {
    if (!this.button) {
      return;
    }
    this.button.removeEventListener('mousedown', stopTerminalPointerEvent);
    this.button.removeEventListener('click', this.copyCommand);
    this.button.remove();
    this.button = null;
  }
}

function stopTerminalPointerEvent(event: MouseEvent): void {
  event.stopPropagation();
}

function getCopyStatePresentation(state: CopyState): { label: string; symbol: string } {
  switch (state) {
    case 'copied':
      return { label: 'Copied command and output', symbol: '✓' };
    case 'error':
      return { label: 'Copy command and output failed', symbol: '!' };
    case 'idle':
      return { label: 'Copy command and output', symbol: '⧉' };
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(text);
}
