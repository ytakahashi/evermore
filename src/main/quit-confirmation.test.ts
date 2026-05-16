import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../shared/settings-defaults';
import type { AppSettings, PaneRuntimeInfo } from '../shared/types';
import { isRunningOnlyConditionMet, QuitConfirmationController } from './quit-confirmation';

type ShowMessageBox = (
  window: BrowserWindow | null,
  options: MessageBoxOptions,
) => Promise<{ response: number }>;

const idlePane: PaneRuntimeInfo = {
  ptyId: 'pty-idle',
  processActivity: 'idle',
  foregroundSession: { kind: 'none' },
  integration: {
    shell: false,
    protocols: [],
    lastSequenceAt: 0,
    stale: false,
  },
  observedAt: 1,
};

const runningPane: PaneRuntimeInfo = {
  ptyId: 'pty-1',
  processActivity: 'running',
  foregroundCommand: 'pnpm test',
  foregroundSession: { kind: 'other' },
  integration: {
    shell: false,
    protocols: [],
    lastSequenceAt: 0,
    stale: false,
  },
  observedAt: 1,
};

describe('isRunningOnlyConditionMet', () => {
  it('matches pane and tunnel activity for running-only mode', () => {
    // Given/When/Then: running-only mode prompts when either runtime source is active.
    expect(isRunningOnlyConditionMet([idlePane], false)).toBe(false);
    expect(isRunningOnlyConditionMet([idlePane], true)).toBe(true);
    expect(isRunningOnlyConditionMet([runningPane], false)).toBe(true);
    expect(isRunningOnlyConditionMet([runningPane], true)).toBe(true);
  });
});

describe('QuitConfirmationController', () => {
  let settings: AppSettings;
  let panes: PaneRuntimeInfo[];
  let cleanup: ReturnType<typeof vi.fn<() => void>>;
  let hasActiveTunnelForQuitConfirm: ReturnType<typeof vi.fn<() => boolean>>;
  let requestQuit: ReturnType<typeof vi.fn<() => void>>;
  let showMessageBox: ReturnType<typeof vi.fn<ShowMessageBox>>;
  let preventDefault: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    settings = { ...DEFAULT_APP_SETTINGS, app: { quitConfirm: 'running-only' } };
    panes = [runningPane];
    cleanup = vi.fn();
    hasActiveTunnelForQuitConfirm = vi.fn(() => false);
    requestQuit = vi.fn();
    showMessageBox = vi.fn(() => Promise.resolve({ response: 1 }));
    preventDefault = vi.fn();
  });

  function createController(): QuitConfirmationController {
    return new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      hasActiveTunnelForQuitConfirm,
      listPaneInfo: () => panes,
      requestQuit,
      showMessageBox,
    });
  }

  it('allows quit immediately when no confirmation is needed', () => {
    // Given: quit confirmation is disabled.
    settings = { ...settings, app: { quitConfirm: 'never' } };
    const controller = createController();

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });

    // Then: shutdown cleanup runs and no prompt is shown.
    expect(preventDefault).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('cancels quit when the user dismisses the prompt', async () => {
    // Given: confirmation is required and the user chooses Cancel.
    const controller = createController();

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
    const controller = createController();

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();

    // Then: runtime cleanup runs before app.quit is requested again.
    expect(cleanup).toHaveBeenCalledOnce();
    expect(requestQuit).toHaveBeenCalledOnce();
  });

  it.each([
    {
      expectedDetail: 'Quitting will close Evermore and stop any running terminal sessions.',
      expectedMessage: 'A terminal process is still running.',
      name: 'pane only',
      paneInfo: [runningPane],
      tunnelActiveForQuit: false,
    },
    {
      expectedDetail: 'Quitting will close Evermore and stop any active SSH tunnels.',
      expectedMessage: 'An SSH tunnel is still active.',
      name: 'tunnel only',
      paneInfo: [idlePane],
      tunnelActiveForQuit: true,
    },
    {
      expectedDetail:
        'Quitting will close Evermore, stop running terminal sessions, and close active SSH tunnels.',
      expectedMessage: 'Terminal processes and SSH tunnels are still active.',
      name: 'pane and tunnel',
      paneInfo: [runningPane],
      tunnelActiveForQuit: true,
    },
  ])('uses running-only dialog copy for $name', async (scenario) => {
    // Given: the current runtime snapshot requires a running-only prompt.
    panes = scenario.paneInfo;
    hasActiveTunnelForQuitConfirm = vi.fn(() => scenario.tunnelActiveForQuit);
    const controller = createController();

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();

    // Then: the dialog copy matches the active runtime source.
    expect(showMessageBox).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        detail: scenario.expectedDetail,
        message: scenario.expectedMessage,
      }),
    );
  });

  it('uses generic dialog copy in always mode', async () => {
    // Given: always mode prompts even when no pane or tunnel is active.
    settings = { ...settings, app: { quitConfirm: 'always' } };
    panes = [idlePane];
    hasActiveTunnelForQuitConfirm = vi.fn(() => false);
    const listPaneInfo = vi.fn(() => panes);
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      hasActiveTunnelForQuitConfirm,
      listPaneInfo,
      requestQuit,
      showMessageBox,
    });

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();

    // Then: the prompt avoids runtime-specific copy.
    const options = showMessageBox.mock.calls[0]?.[1];
    expect(options).toEqual(
      expect.objectContaining({
        detail: 'Evermore will close.',
        message: 'Quit Evermore?',
      }),
    );
    expect(options?.message).not.toMatch(/terminal process|SSH tunnel/i);
    expect(options?.detail).not.toMatch(/terminal session|SSH tunnel/i);
    expect(listPaneInfo).not.toHaveBeenCalled();
    expect(hasActiveTunnelForQuitConfirm).not.toHaveBeenCalled();
  });

  it('does not re-evaluate runtime state while a prompt is open', () => {
    // Given: a quit prompt is already being shown.
    showMessageBox = vi.fn(() => new Promise(() => undefined));
    const listPaneInfo = vi.fn(() => panes);
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      hasActiveTunnelForQuitConfirm,
      listPaneInfo,
      requestQuit,
      showMessageBox,
    });

    // When: Electron emits before-quit twice before the dialog resolves.
    controller.handleBeforeQuit({ preventDefault });
    controller.handleBeforeQuit({ preventDefault });

    // Then: the second event is still cancelled, but the original snapshot is reused.
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(listPaneInfo).toHaveBeenCalledOnce();
    expect(hasActiveTunnelForQuitConfirm).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledOnce();
  });

  it('skips runtime evaluation after the user has confirmed quit', async () => {
    // Given: the user has already accepted the confirmation prompt.
    showMessageBox = vi.fn(() => Promise.resolve({ response: 0 }));
    const listPaneInfo = vi.fn(() => panes);
    const controller = new QuitConfirmationController({
      cleanup,
      getSettings: () => settings,
      getWindow: () => null,
      hasActiveTunnelForQuitConfirm,
      listPaneInfo,
      requestQuit,
      showMessageBox,
    });
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();
    cleanup.mockClear();
    listPaneInfo.mockClear();
    hasActiveTunnelForQuitConfirm.mockClear();

    // When: Electron emits the second before-quit produced by app.quit().
    controller.handleBeforeQuit({ preventDefault });

    // Then: cleanup runs without rebuilding the runtime snapshot.
    expect(cleanup).toHaveBeenCalledOnce();
    expect(listPaneInfo).not.toHaveBeenCalled();
    expect(hasActiveTunnelForQuitConfirm).not.toHaveBeenCalled();
  });

  it('cancels quit and resets prompt state when the dialog fails', async () => {
    // Given: Electron fails to show the confirmation dialog.
    showMessageBox = vi.fn(() => Promise.reject(new Error('dialog unavailable')));
    const controller = createController();

    // When: Electron emits before-quit.
    controller.handleBeforeQuit({ preventDefault });
    await Promise.resolve();
    await Promise.resolve();

    // Then: quit remains cancelled and a later quit attempt can show the prompt again.
    expect(cleanup).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
    controller.handleBeforeQuit({ preventDefault });
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });
});
