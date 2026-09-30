import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { attachHideOnClose, type HideOnCloseHandle } from './window-close-behavior';

type Listener = (event: { preventDefault: () => void }) => void;

interface FakeWindow {
  emit: (channel: string) => { defaultPrevented: boolean };
  hide: ReturnType<typeof vi.fn<() => void>>;
  show: ReturnType<typeof vi.fn<() => void>>;
  focus: ReturnType<typeof vi.fn<() => void>>;
  setFullScreen: ReturnType<typeof vi.fn<(flag: boolean) => void>>;
  isFullScreen: ReturnType<typeof vi.fn<() => boolean>>;
  isDestroyed: ReturnType<typeof vi.fn<() => boolean>>;
}

interface Harness {
  window: FakeWindow;
  handle: HideOnCloseHandle;
  setQuitting: (value: boolean) => void;
}

function createHarness({ fullScreen = false }: { fullScreen?: boolean } = {}): Harness {
  const listeners = new Map<string, { listener: Listener; once: boolean }[]>();
  const addListener =
    (once: boolean) =>
    (channel: string, listener: Listener): void => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), { listener, once }]);
    };
  let quitting = false;
  // Mirrors Electron: `show` is emitted only when a hidden window becomes visible, so calling
  // `show()` on an already visible window cannot clear state through the `show` listener.
  let visible = true;
  const window: FakeWindow = {
    emit: (channel) => {
      let defaultPrevented = false;
      const event = {
        preventDefault: (): void => {
          defaultPrevented = true;
        },
      };
      const entries = listeners.get(channel) ?? [];
      listeners.set(
        channel,
        entries.filter((entry) => !entry.once),
      );
      for (const entry of entries) {
        entry.listener(event);
      }
      return { defaultPrevented };
    },
    hide: vi.fn(() => {
      visible = false;
    }),
    show: vi.fn(() => {
      if (visible) {
        return;
      }
      visible = true;
      window.emit('show');
    }),
    focus: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(() => fullScreen),
    isDestroyed: vi.fn(() => false),
  };
  const fakeBrowserWindow = {
    ...window,
    on: addListener(false),
    once: addListener(true),
  } as unknown as BrowserWindow;

  const handle = attachHideOnClose(fakeBrowserWindow, { isQuitting: () => quitting });

  return {
    window,
    handle,
    setQuitting: (value) => {
      quitting = value;
    },
  };
}

describe('attachHideOnClose', () => {
  it('hides the window instead of closing it', () => {
    // Given: a window with hide-on-close attached and no quit in progress.
    const { window } = createHarness();

    // When: the user closes the window.
    const result = window.emit('close');

    // Then: the close is cancelled and the window is hidden.
    expect(result.defaultPrevented).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it('lets the close proceed once the app is quitting', () => {
    // Given: the app has committed to quitting.
    const { window, setQuitting } = createHarness();
    setQuitting(true);

    // When: Electron closes the window as part of the quit.
    const result = window.emit('close');

    // Then: the close is not intercepted.
    expect(result.defaultPrevented).toBe(false);
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('leaves fullscreen before hiding a fullscreen window', () => {
    // Given: a fullscreen window.
    const { window } = createHarness({ fullScreen: true });

    // When: the user closes the window.
    const result = window.emit('close');

    // Then: fullscreen is exited first and the hide waits for the transition to finish.
    expect(result.defaultPrevented).toBe(true);
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.hide).not.toHaveBeenCalled();

    window.emit('leave-full-screen');
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it('keeps a fullscreen hide pending across show events emitted during the transition', () => {
    // Given: a fullscreen close is waiting for the native exit transition.
    const { window } = createHarness({ fullScreen: true });
    window.emit('close');

    // When: macOS reports an occlusion change as `show` before fullscreen exit completes.
    window.emit('show');
    window.emit('leave-full-screen');

    // Then: the deferred hide still runs.
    expect(window.hide).toHaveBeenCalledOnce();
  });

  it('cancels a fullscreen hide when the Dock reactivates the window during the transition', () => {
    // Given: a fullscreen close is waiting for the native exit transition.
    const { window, handle } = createHarness({ fullScreen: true });
    window.emit('close');

    // When: the Dock reactivates the app before fullscreen exit completes.
    const revealed = handle.revealIfHidden();
    window.emit('leave-full-screen');

    // Then: the existing window stays shown and the delayed event cannot hide it.
    expect(revealed).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('cancels a fullscreen hide when another window reveal path runs', () => {
    // Given: a fullscreen close is waiting for the native exit transition.
    const { window, handle } = createHarness({ fullScreen: true });
    window.emit('close');

    // When: a hotkey or notification reveals the already visible window.
    handle.cancelPendingHide();
    window.emit('leave-full-screen');

    // Then: the delayed event cannot hide the window.
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('defers a repeated close until the fullscreen exit finishes', () => {
    // Given: a fullscreen hide was cancelled while the native transition is still running.
    const { window, handle } = createHarness({ fullScreen: true });
    window.emit('close');
    handle.cancelPendingHide();
    window.isFullScreen.mockReturnValue(false);

    // When: another close arrives after isFullScreen() has already changed to false.
    window.emit('close');
    expect(window.hide).not.toHaveBeenCalled();

    // Then: the window hides once the original transition completes.
    window.emit('leave-full-screen');
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.setFullScreen).toHaveBeenCalledOnce();
  });

  it('does not hide after quitting during a fullscreen exit', () => {
    // Given: a fullscreen hide is pending when the app commits to quitting.
    const { window, setQuitting } = createHarness({ fullScreen: true });
    window.emit('close');
    setQuitting(true);

    // When: the fullscreen transition completes.
    window.emit('leave-full-screen');

    // Then: the pending callback leaves the closing window alone.
    expect(window.hide).not.toHaveBeenCalled();
  });

  it('reveals a window hidden by close', () => {
    // Given: a window hidden by an intercepted close.
    const { window, handle } = createHarness();
    window.emit('close');

    // When: the app is re-activated.
    const revealed = handle.revealIfHidden();

    // Then: the window is shown and focused.
    expect(revealed).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('does not reveal a window that was not hidden by close', () => {
    // Given: a freshly created window still waiting for ready-to-show.
    const { window, handle } = createHarness();

    // When: macOS emits activate during launch.
    const revealed = handle.revealIfHidden();

    // Then: the window is left for the ready-to-show path to show.
    expect(revealed).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
  });

  it('keeps the hidden state across show events emitted after the hide', () => {
    // Given: a window hidden at the end of a fullscreen exit.
    const { window, handle } = createHarness({ fullScreen: true });
    window.emit('close');
    window.emit('leave-full-screen');

    // When: macOS reports a late occlusion change as `show`, then the Dock reactivates the app.
    window.emit('show');
    const revealed = handle.revealIfHidden();

    // Then: the window is still revealed.
    expect(revealed).toBe(true);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it('reveals only once per close', () => {
    // Given: a window hidden by close and already revealed by the Dock.
    const { window, handle } = createHarness();
    window.emit('close');
    handle.revealIfHidden();
    window.show.mockClear();

    // When: the app is re-activated again.
    const revealed = handle.revealIfHidden();

    // Then: nothing is done so the launch-time activate guard stays meaningful.
    expect(revealed).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
  });

  it('does not reveal a destroyed window', () => {
    // Given: a window hidden by close that has since been destroyed.
    const { window, handle } = createHarness();
    window.emit('close');
    window.isDestroyed.mockReturnValue(true);

    // When: the app is re-activated.
    const revealed = handle.revealIfHidden();

    // Then: nothing is shown so the caller can fall back to creating a window.
    expect(revealed).toBe(false);
    expect(window.show).not.toHaveBeenCalled();
  });
});
