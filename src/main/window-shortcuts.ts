import type { BrowserWindow } from 'electron';
import { is } from '@electron-toolkit/utils';

export interface AttachWindowShortcutsOptions {
  /**
   * Overrides `is.dev` for tests. When unset, defaults to `@electron-toolkit/utils`'s `is.dev`,
   * matching the behavior `optimizer.watchWindowShortcuts` previously gated on.
   */
  isDev?: boolean;
}

/**
 * Suppresses Cmd-modified renderer shortcuts (reload, zoom, production DevTools) while letting
 * every Ctrl-modified or unmodified key reach the renderer.
 *
 * `optimizer.watchWindowShortcuts` from `@electron-toolkit/utils` OR-blocks
 * `KeyR && (input.control || input.meta)`, which kills Ctrl+R for shell reverse-i-search as a
 * side-effect of suppressing Cmd+R reload. Phase 3.5 targets macOS only (§15.9), so system
 * shortcuts come through Cmd. Splitting on `input.meta` lets us keep the renderer-level blocks
 * we actually want without swallowing terminal control keys.
 *
 * macOS system shortcuts (Cmd+Q / Cmd+W / Cmd+M, etc.) are untouched because we never call
 * `event.preventDefault()` for them.
 */
export function attachWindowShortcuts(
  window: BrowserWindow,
  options: AttachWindowShortcutsOptions = {},
): void {
  const isDev = options.isDev ?? is.dev;

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return;
    }
    if (!input.meta) {
      // Ctrl-only / Alt-only / unmodified keys (including Ctrl+R for reverse-i-search and
      // Ctrl+- / Ctrl+= which terminals can use) reach xterm untouched.
      return;
    }

    if (input.code === 'KeyR') {
      // Cmd+R: renderer reload. Pressing it inside the app should not throw away the workspace.
      event.preventDefault();
      return;
    }

    if (input.code === 'Minus' || input.code === 'Equal') {
      // Cmd+- / Cmd+=: renderer zoom. Zooming the renderer drifts the xterm cell width away from
      // the PTY's reported size, so we suppress it entirely.
      event.preventDefault();
      return;
    }

    if (input.code === 'KeyI' && input.alt && !isDev) {
      // Cmd+Option+I: production DevTools toggle. Allowed in dev so debugging still works.
      event.preventDefault();
      return;
    }
  });
}
