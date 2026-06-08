import { ipcMain } from 'electron';
import { IPC } from '../../../shared/ipc-channels';
import { SshConfigManager } from '../../ssh-config/manager';
import { SshHostResolver } from '../../ssh-config/host-resolver';
import { readAliasPayload } from '../validation';

interface RegisterSshHandlersOptions {
  sshConfigManager?: Pick<SshConfigManager, 'list' | 'refresh'>;
  sshHostResolver?: Pick<SshHostResolver, 'resolve' | 'clear'>;
}

/**
 * Bridges renderer SSH config requests to the main-process config manager.
 */
export function registerSshHandlers(options: RegisterSshHandlersOptions = {}): () => void {
  const sshConfigManager = options.sshConfigManager ?? new SshConfigManager();
  const sshHostResolver = options.sshHostResolver ?? new SshHostResolver();

  ipcMain.handle(IPC.SSH_LIST_HOSTS, () => sshConfigManager.list());
  ipcMain.handle(IPC.SSH_RELOAD_HOSTS, () => {
    const hosts = sshConfigManager.refresh();
    // Invalidate the resolution cache when the configuration is reloaded,
    // as the underlying values might have changed.
    sshHostResolver.clear();
    return hosts;
  });
  ipcMain.handle(IPC.SSH_RESOLVE, (_event, payload: unknown) =>
    sshHostResolver.resolve(readAliasPayload(payload, IPC.SSH_RESOLVE)),
  );

  return () => {
    ipcMain.removeHandler(IPC.SSH_LIST_HOSTS);
    ipcMain.removeHandler(IPC.SSH_RELOAD_HOSTS);
    ipcMain.removeHandler(IPC.SSH_RESOLVE);
  };
}
