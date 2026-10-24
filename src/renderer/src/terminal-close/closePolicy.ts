import type { ConfirmMode, PaneRuntimeInfo } from '../../../shared/types';

/**
 * Returns whether any supplied PTY currently owns a running foreground process.
 */
export function hasRunningPty(
  ptyIds: readonly (string | undefined)[],
  infosByPtyId: Readonly<Record<string, PaneRuntimeInfo>>,
): boolean {
  return ptyIds.some(
    (ptyId) => ptyId !== undefined && infosByPtyId[ptyId]?.processActivity === 'running',
  );
}

/**
 * Returns whether the configured policy requires confirmation for a terminal close.
 *
 * SSH tunnels are deliberately excluded because they are app-wide resources and closing terminals
 * does not stop them. Quit confirmation remains responsible for protecting active tunnels.
 */
export function shouldConfirmTerminalClose(options: {
  mode: ConfirmMode;
  runningProcesses: boolean;
}): boolean {
  if (options.mode === 'never') {
    return false;
  }
  if (options.mode === 'always') {
    return true;
  }
  return options.runningProcesses;
}
