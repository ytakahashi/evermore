import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../shared/settings-defaults';
import type { AppSettings, PaneRuntimeInfo } from '../shared/types';
import { QuitConfirmationController, shouldConfirmQuit } from './quit-confirmation';

describe('shouldConfirmQuit', () => {
  it('follows the quitConfirm setting', () => {
    // Given: pane runtime info contains a running process.
    const runningPane: PaneRuntimeInfo = {
      ptyId: 'pty-1',
      activity: 'running',
      foregroundCommand: 'pnpm test',
      observedAt: 1,
    };

    // When/Then: each quit mode maps to the documented prompt behavior.
    expect(
      shouldConfirmQuit({ ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'never' } }, [runningPane]),
    ).toBe(false);
    expect(shouldConfirmQuit({ ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'always' } }, [])).toBe(
      true,
    );
    expect(
      shouldConfirmQuit({ ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'running-only' } }, []),
    ).toBe(false);
    expect(
      shouldConfirmQuit({ ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'running-only' } }, [
        runningPane,
      ]),
    ).toBe(true);
  });
});

describe('QuitConfirmationController', () => {
  let settings: AppSettings;
  let panes: PaneRuntimeInfo[];
  let cleanup: ReturnType<typeof vi.fn<() => void>>;
  let requestQuit: ReturnType<typeof vi.fn<() => void>>;
  let showMessageBox: ReturnType<
    typeof vi.fn<(window: BrowserWindow | null) => Promise<{ response: number }>>
  >;
  let preventDefault: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    settings = { ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'running-only' } };
    panes = [
      {
        ptyId: 'pty-1',
        activity: 'running',
        foregroundCommand: 'pnpm dev',
        observedAt: 1,
      },
    ];
    cleanup = vi.fn();
    requestQuit = vi.fn();
    showMessageBox = vi.fn(() => Promise.resolve({ response: 1 }));
    preventDefault = vi.fn();
  });

  it('allows quit immediately when no confirmation is needed', () => {
    // Given: quit confirmation is disabled.
    settings = { ...settings, app: { quitConfirm: 'never' } };
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      listPaneInfo: () => panes,
      requestQuit,
      showMessageBox,
    });

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });

    // Then: shutdown cleanup runs and no prompt is shown.
    expect(preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('cancels quit when the user dismisses the prompt', async () => {
    // Given: confirmation is required and the user chooses Cancel.
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      listPaneInfo: () => panes,
      requestQuit,
      showMessageBox,
    });

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();

    // Then: the quit is prevented and cleanup does not run.
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it('cleans up and re-requests quit when the user confirms', async () => {
    // Given: confirmation is required and the user chooses Quit.
    showMessageBox = vi.fn(() => Promise.resolve({ response: 0 }));
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      listPaneInfo: () => panes,
      requestQuit,
      showMessageBox,
    });

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();

    // Then: runtime cleanup runs before app.quit is requested again.
    expect(cleanup).toHaveBeenCalledOnce();
    expect(requestQuit).toHaveBeenCalledOnce();
  });
});
