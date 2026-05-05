import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import { SshConfigManager } from '../../ssh-config/manager';

interface RegisterSshHandlersOptions {
  sshConfigManager?: Pick<SshConfigManager, 'list' | 'refresh'>;
}

/**
 * Bridges renderer SSH config requests to the main-process config manager.
 */
export function registerSshHandlers(options: RegisterSshHandlersOptions = {}): () => void {
  const sshConfigManager = options.sshConfigManager ?? new SshConfigManager();

  ipcMain.handle(IPC.SSH_LIST_HOSTS, () => sshConfigManager.list());
  ipcMain.handle(IPC.SSH_RELOAD_HOSTS, () => sshConfigManager.refresh());

  return () => {
    ipcMain.removeHandler(IPC.SSH_LIST_HOSTS);
    ipcMain.removeHandler(IPC.SSH_RELOAD_HOSTS);
  };
}
