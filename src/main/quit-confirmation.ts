import type { BrowserWindow, MessageBoxOptions } from 'electron';
import type { AppSettings, PaneRuntimeInfo } from '../shared/types';

interface BeforeQuitEvent {
  preventDefault: () => void;
}

interface QuitConfirmationControllerOptions {
  cleanup: () => void;
  getSettings: () => AppSettings;
  getWindow: () => BrowserWindow | null;
  hasActiveTunnelForQuitConfirm: () => boolean;
  listPaneInfo: () => PaneRuntimeInfo[];
  requestQuit: () => void;
  showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
}

/**
 * Returns whether `running-only` mode has runtime activity that needs confirmation.
 */
export function isRunningOnlyConditionMet(
  paneInfo: readonly PaneRuntimeInfo[],
  tunnelActiveForQuit: boolean,
): boolean {
  return paneInfo.some((info) => getProcessActivity(info) === 'running') || tunnelActiveForQuit;
}

function hasRunningPane(paneInfo: readonly PaneRuntimeInfo[]): boolean {
  return paneInfo.some((info) => getProcessActivity(info) === 'running');
}

function getProcessActivity(info: PaneRuntimeInfo): PaneRuntimeInfo['processActivity'] {
  return info.processActivity ?? info.activity;
}

function createGenericDialogOptions(): MessageBoxOptions {
  return {
    type: 'warning',
    buttons: ['Quit Evermore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Quit Evermore?',
    message: 'Quit Evermore?',
    detail: 'Evermore will close.',
    noLink: true,
  };
}

function createRunningOnlyDialogOptions(
  paneRunningForQuit: boolean,
  tunnelActiveForQuit: boolean,
): MessageBoxOptions {
  const baseOptions = createGenericDialogOptions();

  if (paneRunningForQuit && tunnelActiveForQuit) {
    return {
      ...baseOptions,
      message: 'Terminal processes and SSH tunnels are still active.',
      detail:
        'Quitting will close Evermore, stop running terminal sessions, and close active SSH tunnels.',
    };
  }

  if (tunnelActiveForQuit) {
    return {
      ...baseOptions,
      message: 'An SSH tunnel is still active.',
      detail: 'Quitting will close Evermore and stop any active SSH tunnels.',
    };
  }

  return {
    ...baseOptions,
    message: 'A terminal process is still running.',
    detail: 'Quitting will close Evermore and stop any running terminal sessions.',
  };
}

/**
 * Coordinates the Cmd+Q confirmation dialog and shutdown cleanup.
 */
export class QuitConfirmationController {
  private readonly cleanup: () => void;
  private readonly getSettings: () => AppSettings;
  private readonly getWindow: () => BrowserWindow | null;
  private readonly hasActiveTunnelForQuitConfirm: () => boolean;
  private readonly listPaneInfo: () => PaneRuntimeInfo[];
  private readonly requestQuit: () => void;
  private readonly showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
  private confirmedQuit = false;
  private promptOpen = false;

  public constructor(options: QuitConfirmationControllerOptions) {
    this.cleanup = options.cleanup;
    this.getSettings = options.getSettings;
    this.getWindow = options.getWindow;
    this.hasActiveTunnelForQuitConfirm = options.hasActiveTunnelForQuitConfirm;
    this.listPaneInfo = options.listPaneInfo;
    this.requestQuit = options.requestQuit;
    this.showMessageBox = options.showMessageBox;
  }

  /**
   * Handles Electron's `before-quit` event. Cleanup runs only once the quit is allowed to continue.
   */
  public handleBeforeQuit(event: BeforeQuitEvent): void {
    if (this.confirmedQuit) {
      this.cleanup();
      return;
    }

    if (this.promptOpen) {
      event.preventDefault();
      return;
    }

    const settings = this.getSettings();
    let dialogOptions: MessageBoxOptions;

    if (settings.app.quitConfirm === 'always') {
      dialogOptions = createGenericDialogOptions();
    } else if (settings.app.quitConfirm === 'never') {
      this.cleanup();
      return;
    } else {
      const paneInfo = this.listPaneInfo();
      const tunnelActiveForQuit = this.hasActiveTunnelForQuitConfirm();

      if (!isRunningOnlyConditionMet(paneInfo, tunnelActiveForQuit)) {
        this.cleanup();
        return;
      }

      dialogOptions = createRunningOnlyDialogOptions(hasRunningPane(paneInfo), tunnelActiveForQuit);
    }

    event.preventDefault();
    this.promptOpen = true;
    void this.showMessageBox(this.getWindow(), dialogOptions)
      .then((result) => {
        this.promptOpen = false;
        if (result.response !== 0) {
          return;
        }

        this.confirmedQuit = true;
        this.cleanup();
        this.requestQuit();
      })
      .catch((_error: unknown) => {
        // Treat dialog failures as a cancelled quit so the next before-quit can retry the prompt.
        this.promptOpen = false;
      });
  }
}
