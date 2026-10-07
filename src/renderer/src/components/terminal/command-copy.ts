import type { IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import { createTerminalCommandCopyText, type CommandCopyMode } from './command-output';

type SetTimeout = (callback: () => void, delay: number) => ReturnType<typeof globalThis.setTimeout>;
type ClearTimeout = (timer: ReturnType<typeof globalThis.setTimeout>) => void;

export interface TerminalCommandCopyState {
  readonly status: 'idle' | 'copied' | 'error';
  readonly mode: CommandCopyMode;
  readonly busy: boolean;
  readonly outputAvailable: boolean;
}

export interface TerminalCommandCopyOptions {
  terminal: Terminal;
  entry: TerminalCommandHistoryEntry;
  writeClipboardText?: (text: string) => Promise<void>;
  setTimeoutFn?: SetTimeout;
  clearTimeoutFn?: ClearTimeout;
}

/** Owns verified copies and temporary feedback independently of a command's rendered decorations. */
export class TerminalCommandCopyController implements IDisposable {
  private state: TerminalCommandCopyState;
  private readonly listeners = new Set<(state: TerminalCommandCopyState) => void>();
  private readonly resizeDisposable: IDisposable;
  private readonly writeClipboardText: (text: string) => Promise<void>;
  private readonly setTimeoutFn: SetTimeout;
  private readonly clearTimeoutFn: ClearTimeout;
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private disposed = false;

  public constructor(private readonly options: TerminalCommandCopyOptions) {
    this.state = {
      status: 'idle',
      mode: 'command-and-output',
      busy: false,
      outputAvailable:
        options.entry.endsAtLineStart || options.terminal.cols === options.entry.completionCols,
    };
    this.writeClipboardText = options.writeClipboardText ?? writeClipboardText;
    // Chromium timers need their Window receiver even when retained by a controller.
    this.setTimeoutFn =
      options.setTimeoutFn ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimeoutFn = options.clearTimeoutFn ?? ((timer) => globalThis.clearTimeout(timer));
    this.resizeDisposable = options.terminal.onResize(({ cols }) => {
      if (
        !options.entry.endsAtLineStart &&
        cols !== options.entry.completionCols &&
        this.state.outputAvailable
      ) {
        // End columns cannot be recovered after reflow, even if the original width is restored.
        this.update({ outputAvailable: false });
      }
    });
  }

  /** Returns a snapshot that survives DOM recreation and selection changes. */
  public getState(): TerminalCommandCopyState {
    return this.state;
  }

  /** Subscribes to state changes; callers read getState for the initial presentation. */
  public onStateChange(listener: (state: TerminalCommandCopyState) => void): IDisposable {
    if (this.disposed) {
      return { dispose: () => undefined };
    }
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  /** Copies a captured command or verified output; duplicate requests while busy are ignored. */
  public async copy(mode: CommandCopyMode): Promise<void> {
    if (this.disposed || this.state.busy) {
      return;
    }
    this.clearTimer();
    const text =
      mode !== 'command' && !this.state.outputAvailable
        ? null
        : createTerminalCommandCopyText(
            this.options.terminal.buffer.normal,
            this.options.entry,
            mode,
          );
    if (text === null || text.length === 0) {
      this.feedback('error', mode);
      return;
    }
    this.update({ status: 'idle', mode, busy: true });
    if (this.disposed) {
      return;
    }
    try {
      await this.writeClipboardText(text);
      if (!this.disposed) {
        this.feedback('copied', mode);
      }
    } catch (_error: unknown) {
      // Clipboard permissions and host availability can reject writes; visible feedback enables retry.
      if (!this.disposed) {
        this.feedback('error', mode);
      }
    }
  }

  /** Stops notifications and timers; a Clipboard API write already started cannot be cancelled. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearTimer();
    this.resizeDisposable.dispose();
    this.listeners.clear();
  }

  private feedback(status: 'copied' | 'error', mode: CommandCopyMode): void {
    this.update({ status, mode, busy: false });
    if (this.disposed) {
      return;
    }
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      if (!this.disposed) {
        this.update({ status: 'idle' });
      }
    }, 1500);
  }

  private update(state: Partial<TerminalCommandCopyState>): void {
    this.state = { ...this.state, ...state };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    throw new Error('Clipboard API is unavailable');
  }
  await navigator.clipboard.writeText(text);
}
