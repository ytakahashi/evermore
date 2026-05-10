import type { BrowserWindow, MessageBoxOptions } from 'electron';
import type { AppSettings, PaneRuntimeInfo } from '../shared/types';

interface BeforeQuitEvent {
  preventDefault: () => void;
}

interface QuitConfirmationControllerOptions {
  cleanup: () => void;
  getSettings: () => AppSettings;
  getWindow: () => BrowserWindow | null;
  listPaneInfo: () => PaneRuntimeInfo[];
  requestQuit: () => void;
  showMessageBox: (
    window: BrowserWindow | null,
    options: MessageBoxOptions,
  ) => Promise<{ response: number }>;
}

/**
 * Returns whether the current settings and pane activity require a quit confirmation prompt.
 */
export function shouldConfirmQuit(
  settings: AppSettings,
  paneInfo: readonly PaneRuntimeInfo[],
): boolean {
  if (settings.app.quitConfirm === 'never') {
    return false;
  }

  if (settings.app.quitConfirm === 'always') {
    return true;
  }

  return paneInfo.some((info) => info.activity === 'running');
}

/**
 * Coordinates the Cmd+Q confirmation dialog and shutdown cleanup.
 */
export class QuitConfirmationController {
  private readonly cleanup: () => void;
  private readonly getSettings: () => AppSettings;
  private readonly getWindow: () => BrowserWindow | null;
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

    if (!shouldConfirmQuit(this.getSettings(), this.listPaneInfo())) {
      this.cleanup();
      return;
    }

    event.preventDefault();
    if (this.promptOpen) {
      return;
    }

    this.promptOpen = true;
    void this.showMessageBox(this.getWindow(), {
      type: 'warning',
      buttons: ['Quit Evermore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Quit Evermore?',
      message: 'A terminal process is still running.',
      detail: 'Quitting will close Evermore and stop any running terminal sessions.',
      noLink: true,
    }).then((result) => {
      this.promptOpen = false;
      if (result.response !== 0) {
        return;
      }

      this.confirmedQuit = true;
      this.cleanup();
      this.requestQuit();
    });
  }
}
