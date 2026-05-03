import type { BrowserWindow } from 'electron';
import { registerPtyHandlers } from './handlers/pty';

interface RegisterIpcHandlersOptions {
  getWindow: () => BrowserWindow | null;
}

/**
 * Registers all main-process IPC handlers and returns a teardown function for app shutdown.
 *
 * The current window is passed as a getter because macOS can destroy and recreate windows while
 * long-lived main-process services, such as PTYs, continue to be owned outside any one window.
 */
export function registerIpcHandlers(options: RegisterIpcHandlersOptions): () => void {
  const disposePtyHandlers = registerPtyHandlers({ getWindow: options.getWindow });

  return () => {
    disposePtyHandlers();
  };
}
