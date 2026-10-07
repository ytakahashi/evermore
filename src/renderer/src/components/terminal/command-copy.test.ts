import type { Terminal } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { TerminalCommandCopyController } from './command-copy';
import type { TerminalCommandHistoryEntry } from './command-history';

const copyText = vi.hoisted(() => vi.fn());
vi.mock('./command-output', () => ({ createTerminalCommandCopyText: copyText }));

function fixture(
  endsAtLineStart = true,
  writeClipboardText = vi.fn(() => Promise.resolve()),
): {
  controller: TerminalCommandCopyController;
  writeClipboardText: ReturnType<typeof vi.fn<() => Promise<void>>>;
  resizeDisposed: ReturnType<typeof vi.fn>;
  resize: (cols: number) => void;
} {
  let resize: (dimensions: { cols: number; rows: number }) => void = () => undefined;
  const resizeDisposed = vi.fn();
  const terminal = {
    cols: 80,
    buffer: { normal: {} },
    onResize: (listener: typeof resize) => {
      resize = listener;
      return { dispose: resizeDisposed };
    },
  } as unknown as Terminal;
  const entry = {
    endsAtLineStart,
    completionCols: 80,
    command: 'echo result',
  } as TerminalCommandHistoryEntry;
  const controller = new TerminalCommandCopyController({ terminal, entry, writeClipboardText });
  return {
    controller,
    writeClipboardText,
    resizeDisposed,
    resize: (cols: number) => resize({ cols, rows: 24 }),
  };
}

describe('TerminalCommandCopyController', () => {
  beforeEach(() => {
    copyText.mockReset();
    copyText.mockReturnValue('$ echo result\nresult');
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['copied', 'error'] as const)('resets %s feedback after 1.5 seconds', async (status) => {
    // Given: clipboard writes either succeed or reject.
    const write = vi.fn(() =>
      status === 'copied' ? Promise.resolve() : Promise.reject(new Error('denied')),
    );
    const { controller } = fixture(true, write);
    const changed = vi.fn();
    controller.onStateChange(changed);

    // When: a command is copied and its feedback duration elapses.
    await controller.copy('command-and-output');
    expect(controller.getState().status).toBe(status);
    await vi.advanceTimersByTimeAsync(1500);

    // Then: both outcomes return to idle and permit retry.
    expect(controller.getState()).toMatchObject({ status: 'idle', busy: false });
    expect(changed).toHaveBeenCalled();
    controller.dispose();
  });

  it.each([null, ''])(
    'does not overwrite the clipboard for invalid or empty output: %s',
    async (text) => {
      // Given: text reconstruction failed or produced no output.
      const { controller, writeClipboardText } = fixture();
      copyText.mockReturnValue(text);

      // When: output-only copy is requested.
      await controller.copy('output');

      // Then: the clipboard remains unchanged and failure feedback also resets.
      expect(writeClipboardText).not.toHaveBeenCalled();
      expect(controller.getState()).toMatchObject({ status: 'error', mode: 'output', busy: false });
      await vi.advanceTimersByTimeAsync(1500);
      expect(controller.getState().status).toBe('idle');
      controller.dispose();
    },
  );

  it('keeps non-newline output invalid even after restoring the original terminal width', async () => {
    // Given: a completed non-newline output range.
    const { controller, resize, writeClipboardText } = fixture(false);

    // When: columns change and are restored before output and command-only copies.
    resize(40);
    resize(80);
    await controller.copy('output');
    expect(controller.getState().status).toBe('error');
    expect(copyText).not.toHaveBeenCalled();
    copyText.mockReturnValue('echo result');
    await controller.copy('command');

    // Then: command text is still copyable but the old output end column stays unusable.
    expect(controller.getState().outputAvailable).toBe(false);
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith('echo result');
    controller.dispose();
  });

  it('ignores repeated requests and late clipboard completion after disposal', async () => {
    // Given: a clipboard request is pending.
    let resolveWrite = (): void => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const { controller, resizeDisposed } = fixture(true, write);
    const changed = vi.fn();
    controller.onStateChange(changed);
    const pending = controller.copy('output');

    // When: another request arrives, then the owner is disposed before completion.
    await controller.copy('command');
    controller.dispose();
    controller.dispose();
    changed.mockClear();
    resolveWrite();
    await pending;
    await controller.copy('output');

    // Then: no second write, late notification, or timer can revive the disposed controller.
    expect(write).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    expect(resizeDisposed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('captures the requested text before the clipboard write settles', async () => {
    // Given: a deferred clipboard write has captured the output text.
    let resolveWrite = (): void => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    const { controller } = fixture(true, write);
    copyText.mockReturnValue('captured output');
    const pending = controller.copy('output');

    // When: subsequent buffer reconstruction would yield different content.
    copyText.mockReturnValue('changed output');
    resolveWrite();
    await pending;

    // Then: the original explicit request retains its mode and payload.
    expect(write).toHaveBeenCalledExactlyOnceWith('captured output');
    expect(controller.getState()).toMatchObject({ status: 'copied', mode: 'output' });
    controller.dispose();
  });
  it('preserves the browser receiver when scheduling and clearing success feedback', async () => {
    // Given: Chromium-like timers throw when called without the global Window receiver.
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timer = 123 as unknown as ReturnType<typeof globalThis.setTimeout>;
    const setTimeoutSpy = vi.fn(function (
      this: unknown,
      _callback: TimerHandler,
      _delay?: number,
    ): ReturnType<typeof globalThis.setTimeout> {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
      return timer;
    });
    const clearTimeoutSpy = vi.fn(function (this: unknown): void {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation');
      }
    });
    Object.defineProperty(globalThis, 'setTimeout', {
      configurable: true,
      value: setTimeoutSpy,
    });
    Object.defineProperty(globalThis, 'clearTimeout', {
      configurable: true,
      value: clearTimeoutSpy,
    });
    const { controller } = fixture();

    try {
      // When: clipboard writing succeeds and schedules the temporary check state.
      await controller.copy('command-and-output');

      // Then: timer scheduling succeeds instead of converting the copied state to an error.
      expect(controller.getState().status).toBe('copied');
      expect(setTimeoutSpy).toHaveBeenCalledOnce();
      controller.dispose();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
    } finally {
      controller.dispose();
      Object.defineProperty(globalThis, 'setTimeout', {
        configurable: true,
        value: originalSetTimeout,
      });
      Object.defineProperty(globalThis, 'clearTimeout', {
        configurable: true,
        value: originalClearTimeout,
      });
    }
  });
});
