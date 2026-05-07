import type { BrowserWindow } from 'electron';
import { registerPtyHandlers } from './handlers/pty';
import { registerSshHandlers } from './handlers/ssh';
import { registerTunnelHandlers } from './handlers/tunnel';
import { registerWorkspaceHandlers } from './handlers/workspace';
import { SshConfigManager } from '../ssh-config/manager';
import { SshHostResolver } from '../ssh-config/host-resolver';

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
  const sshConfigManager = new SshConfigManager();
  const sshHostResolver = new SshHostResolver();
  const disposePtyHandlers = registerPtyHandlers({ getWindow: options.getWindow });
  const disposeWorkspaceHandlers = registerWorkspaceHandlers();
  const disposeSshHandlers = registerSshHandlers({ sshConfigManager, sshHostResolver });
  const disposeTunnelHandlers = registerTunnelHandlers({
    getWindow: options.getWindow,
    sshConfigManager,
  });

  return () => {
    disposePtyHandlers();
    disposeWorkspaceHandlers();
    disposeSshHandlers();
    disposeTunnelHandlers();
  };
}
