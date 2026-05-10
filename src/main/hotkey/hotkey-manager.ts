import { globalShortcut, type BrowserWindow } from 'electron';

interface HotkeyManagerOptions {
  getWindow: () => BrowserWindow | null;
  register?: (accelerator: string, callback: () => void) => boolean;
  unregister?: (accelerator: string) => void;
}

/**
 * Owns the single global shortcut that brings the Evermore window to the foreground.
 */
export class HotkeyManager {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly registerShortcut: (accelerator: string, callback: () => void) => boolean;
  private readonly unregisterShortcut: (accelerator: string) => void;
  private currentAccelerator: string | null = null;

  public constructor(options: HotkeyManagerOptions) {
    this.getWindow = options.getWindow;
    this.registerShortcut = options.register ?? globalShortcut.register.bind(globalShortcut);
    this.unregisterShortcut = options.unregister ?? globalShortcut.unregister.bind(globalShortcut);
  }

  /**
   * Applies a new accelerator and returns the accelerator that is actually active.
   *
   * If Electron rejects the requested accelerator (typically because another app owns it), the
   * previous accelerator remains active and is returned to the caller so settings persistence can
   * fall back to the last working value.
   */
  public set(accelerator: string | null): string | null {
    if (accelerator === this.currentAccelerator) {
      return this.currentAccelerator;
    }

    if (accelerator === null) {
      this.clearCurrent();
      return null;
    }

    const previousAccelerator = this.currentAccelerator;
    this.clearCurrent();
    const registered = this.registerShortcut(accelerator, () => {
      this.activateWindow();
    });

    if (registered) {
      this.currentAccelerator = accelerator;
      return this.currentAccelerator;
    }

    if (previousAccelerator) {
      const restored = this.registerShortcut(previousAccelerator, () => {
        this.activateWindow();
      });
      this.currentAccelerator = restored ? previousAccelerator : null;
    }

    return this.currentAccelerator;
  }

  /** Unregisters the accelerator owned by this manager. */
  public dispose(): void {
    this.clearCurrent();
  }

  private clearCurrent(): void {
    if (!this.currentAccelerator) {
      return;
    }

    this.unregisterShortcut(this.currentAccelerator);
    this.currentAccelerator = null;
  }

  private activateWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}
