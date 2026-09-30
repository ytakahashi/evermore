import type { BrowserWindow } from 'electron';

export interface AttachHideOnCloseOptions {
  /**
   * Returns true once the app has committed to quitting. The close must then proceed, otherwise
   * the quit would stall on a window that keeps refusing to close.
   */
  isQuitting: () => boolean;
}

export interface HideOnCloseHandle {
  /** Cancels a hide waiting for the native fullscreen exit transition. */
  cancelPendingHide: () => void;
  /**
   * Shows the window again if it was hidden by close (and not revealed through this handle since)
   * or is waiting to hide after fullscreen exit. Returns whether the window was revealed.
   *
   * Windows hidden for any other reason are left alone: in particular a window created with
   * `show: false` that is still waiting for `ready-to-show` must not be shown early, because
   * macOS also emits `activate` during launch.
   */
  revealIfHidden: () => boolean;
}

/**
 * Turns a user-initiated window close into a hide so the renderer and its PTYs stay alive.
 *
 * The renderer owns the pane ↔ PTY mapping, while PTYs are owned by the main process. Destroying
 * the renderer without a React unmount leaves every PTY orphaned in the main process, and a window
 * recreated on reopen would spawn a fresh PTY for each pane on top of them. Hiding instead keeps
 * the single window (and every running session) intact until the app actually quits.
 */
export function attachHideOnClose(
  window: BrowserWindow,
  options: AttachHideOnCloseOptions,
): HideOnCloseHandle {
  let hiddenByClose = false;
  let pendingHide = false;
  let exitingFullScreen = false;

  const hide = (): void => {
    hiddenByClose = true;
    window.hide();
  };

  // This state is deliberately not driven by the window `show` event. On macOS Electron also emits
  // `show` for occlusion changes; after a close from fullscreen, resetting on `show` was observed
  // to leave the window hidden with no Dock reopen path.
  // `hiddenByClose` is cleared only by `revealIfHidden()`. If another path (global hotkey,
  // notification click) shows the window first, a later reveal just re-shows a visible window.

  window.on('close', (event) => {
    if (options.isQuitting()) {
      return;
    }

    event.preventDefault();
    if (exitingFullScreen) {
      // A second close during the same native transition re-arms the hide without adding a
      // second listener or hiding early when isFullScreen() has already changed to false.
      pendingHide = true;
      return;
    }
    if (window.isFullScreen()) {
      // Hiding a native fullscreen window on macOS leaves an empty black Space behind. Leave
      // fullscreen first. A reveal during the transition cancels the deferred hide.
      pendingHide = true;
      exitingFullScreen = true;
      window.once('leave-full-screen', () => {
        exitingFullScreen = false;
        if (pendingHide && !options.isQuitting() && !window.isDestroyed()) {
          hide();
        }
        pendingHide = false;
      });
      window.setFullScreen(false);
      return;
    }

    pendingHide = false;
    hide();
  });

  return {
    cancelPendingHide: () => {
      pendingHide = false;
    },
    revealIfHidden: () => {
      if ((!hiddenByClose && !pendingHide) || window.isDestroyed()) {
        return false;
      }

      hiddenByClose = false;
      pendingHide = false;
      window.show();
      window.focus();
      return true;
    },
  };
}
