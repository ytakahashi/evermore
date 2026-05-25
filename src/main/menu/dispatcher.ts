import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import {
  KEYBOARD_SHORTCUT_ACTION_IDS,
  type KeyboardShortcutActionId,
} from '../../shared/keyboard-shortcuts';
import type { ShortcutDispatchers } from './buildApplicationMenu';

/**
 * Builds the per-action click handlers used by the application menu.
 *
 * Each handler forwards its `actionId` to the renderer via
 * `webContents.send(IPC.SHORTCUT_INVOKE, ...)`. The window resolver is read on each invocation so
 * window recreation across the app lifecycle (macOS reopen-after-close-all) is transparent. The
 * `webContents.isDestroyed()` guard mirrors the rest of the main → renderer event surface — late
 * menu clicks against a closed window are silently dropped rather than crashing.
 *
 * This file lives under `src/main/menu/` rather than `src/main/ipc/handlers/` because it does not
 * register an `ipcMain.handle`; it is a helper consumed by menu click handlers.
 */
export function createShortcutDispatcher(
  getWindow: () => BrowserWindow | null,
): ShortcutDispatchers {
  const dispatchers = {} as ShortcutDispatchers;
  for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
    dispatchers[actionId] = (): void => {
      dispatchShortcut(getWindow, actionId);
    };
  }
  return dispatchers;
}

function dispatchShortcut(
  getWindow: () => BrowserWindow | null,
  actionId: KeyboardShortcutActionId,
): void {
  const window = getWindow();
  if (!window || window.isDestroyed()) {
    return;
  }
  const { webContents } = window;
  if (webContents.isDestroyed()) {
    return;
  }
  webContents.send(IPC.SHORTCUT_INVOKE, { actionId });
}
