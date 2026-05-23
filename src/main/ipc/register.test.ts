import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc-channels';
import type { PaneRuntimeSignal } from '../../shared/pane-runtime-signal';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { AppSettings } from '../../shared/types';
import type { PtyManagerCallbacks } from '../pty/types';
import type { SettingsStore } from '../settings/settings-store';
import type {
  TunnelLogEvent,
  TunnelManagerCallbacks,
  TunnelRuntimeState,
  TunnelStatusChangedEvent,
} from '../tunnels/types';
import { registerIpcHandlers } from './register';

const disposeMocks = vi.hoisted(() => ({
  hotkeyManagerDispose: vi.fn(),
  paneInfoTrackerDispose: vi.fn(),
  ptyHandlers: vi.fn(),
  paneInfoHandlers: vi.fn(),
  settingsHandlers: vi.fn(),
  sshHandlers: vi.fn(),
  tunnelHandlers: vi.fn(),
  windowHandlers: vi.fn(),
  workspaceHandlers: vi.fn(),
}));

const paneInfoTrackerMock = vi.hoisted(() => ({
  applySignal: vi.fn<(ptyId: string, signal: PaneRuntimeSignal) => void>(),
  notifyUserInput: vi.fn<(ptyId: string) => void>(),
  register: vi.fn<(ptyId: string, shellPid: number, cwd: string) => void>(),
  unregister: vi.fn<(ptyId: string) => void>(),
}));

const ptyManagerMock = vi.hoisted(() => ({
  callbacks: undefined as PtyManagerCallbacks | undefined,
}));

const shellIntegrationInjectorMock = vi.hoisted(() => ({
  setAutoInject: vi.fn<(enabled: boolean) => void>(),
  envExtrasForShell: vi.fn<(shell: string, baseEnv: NodeJS.ProcessEnv) => undefined>(
    () => undefined,
  ),
  getDirectory: vi.fn<() => string>(() => '/tmp/evermore-zdotdir'),
}));

const tunnelManagerMock = vi.hoisted(() => ({
  callbacks: undefined as TunnelManagerCallbacks | undefined,
  disposeAll: vi.fn<() => void>(),
  getRuntimeState: vi.fn<(alias: string) => TunnelRuntimeState | undefined>(),
  list: vi.fn<() => Array<{ alias: string; state: TunnelRuntimeState }>>(() => []),
  logs: vi.fn<(alias: string) => string[]>(),
  start: vi.fn<(alias: string) => void>(),
  stop: vi.fn<(alias: string) => void>(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((_name: string) => '/tmp/evermore-userdata'),
  },
}));

vi.mock('../hotkey/hotkey-manager', () => ({
  HotkeyManager: vi.fn().mockImplementation(function () {
    return {
      dispose: disposeMocks.hotkeyManagerDispose,
      set: vi.fn((accelerator: string | null) => accelerator),
    };
  }),
}));

vi.mock('../pane-info/pane-info-tracker', () => ({
  PaneInfoTracker: vi.fn().mockImplementation(function () {
    return {
      applySignal: paneInfoTrackerMock.applySignal,
      dispose: disposeMocks.paneInfoTrackerDispose,
      list: vi.fn(() => []),
      notifyUserInput: paneInfoTrackerMock.notifyUserInput,
      register: paneInfoTrackerMock.register,
      setPollIntervalMs: vi.fn(),
      unregister: paneInfoTrackerMock.unregister,
    };
  }),
}));

vi.mock('../pty/pty-manager', () => ({
  PtyManager: vi.fn().mockImplementation(function (options: { callbacks: PtyManagerCallbacks }) {
    ptyManagerMock.callbacks = options.callbacks;
    return {};
  }),
}));

vi.mock('../shell-integration/injector', () => ({
  ShellIntegrationInjector: vi.fn().mockImplementation(function () {
    return {
      setAutoInject: shellIntegrationInjectorMock.setAutoInject,
      envExtrasForShell: shellIntegrationInjectorMock.envExtrasForShell,
      getDirectory: shellIntegrationInjectorMock.getDirectory,
    };
  }),
}));

vi.mock('../settings/settings-store', () => ({
  SettingsStore: vi.fn().mockImplementation(function () {
    return {
      get: vi.fn(() => DEFAULT_APP_SETTINGS),
      update: vi.fn((settings: AppSettings) => settings),
    };
  }),
}));

vi.mock('../ssh-config/manager', () => ({
  SshConfigManager: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../ssh-config/host-resolver', () => ({
  SshHostResolver: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock('../tunnels/tunnel-manager', () => ({
  TunnelManager: vi.fn().mockImplementation(function (callbacks: TunnelManagerCallbacks) {
    tunnelManagerMock.callbacks = callbacks;
    return {
      disposeAll: tunnelManagerMock.disposeAll,
      getRuntimeState: tunnelManagerMock.getRuntimeState,
      list: tunnelManagerMock.list,
      logs: tunnelManagerMock.logs,
      start: tunnelManagerMock.start,
      stop: tunnelManagerMock.stop,
    };
  }),
}));

vi.mock('./handlers/pty', () => ({
  registerPtyHandlers: vi.fn(() => disposeMocks.ptyHandlers),
}));

vi.mock('./handlers/pane-info', () => ({
  registerPaneInfoHandlers: vi.fn(() => disposeMocks.paneInfoHandlers),
}));

vi.mock('./handlers/settings', () => ({
  registerSettingsHandlers: vi.fn(() => disposeMocks.settingsHandlers),
}));

vi.mock('./handlers/ssh', () => ({
  registerSshHandlers: vi.fn(() => disposeMocks.sshHandlers),
}));

vi.mock('./handlers/tunnel', () => ({
  registerTunnelHandlers: vi.fn(() => disposeMocks.tunnelHandlers),
}));

vi.mock('./handlers/window', () => ({
  registerWindowHandlers: vi.fn(() => disposeMocks.windowHandlers),
}));

vi.mock('./handlers/workspace', () => ({
  registerWorkspaceHandlers: vi.fn(() => disposeMocks.workspaceHandlers),
}));

function createWindowMock(isDestroyed = false): {
  isDestroyed: () => boolean;
  webContents: { send: ReturnType<typeof vi.fn> };
} {
  return {
    isDestroyed: vi.fn(() => isDestroyed),
    webContents: {
      send: vi.fn(),
    },
  };
}

function createSettingsStore(): {
  get: ReturnType<typeof vi.fn<() => AppSettings>>;
  update: ReturnType<typeof vi.fn<(settings: AppSettings) => AppSettings>>;
} {
  return {
    get: vi.fn(() => DEFAULT_APP_SETTINGS),
    update: vi.fn((settings: AppSettings) => settings),
  };
}

describe('registerIpcHandlers', () => {
  beforeEach(() => {
    for (const mock of Object.values(disposeMocks)) {
      mock.mockClear();
    }
    tunnelManagerMock.callbacks = undefined;
    tunnelManagerMock.disposeAll.mockClear();
    tunnelManagerMock.getRuntimeState.mockClear();
    tunnelManagerMock.list.mockReset();
    tunnelManagerMock.list.mockReturnValue([]);
    tunnelManagerMock.logs.mockClear();
    tunnelManagerMock.start.mockClear();
    tunnelManagerMock.stop.mockClear();
    paneInfoTrackerMock.applySignal.mockClear();
    paneInfoTrackerMock.notifyUserInput.mockClear();
    paneInfoTrackerMock.register.mockClear();
    paneInfoTrackerMock.unregister.mockClear();
    ptyManagerMock.callbacks = undefined;
    shellIntegrationInjectorMock.setAutoInject.mockClear();
    shellIntegrationInjectorMock.envExtrasForShell.mockClear();
  });

  it('broadcasts tunnel status and log events to the current window', () => {
    // Given: IPC runtime is registered with an available BrowserWindow.
    const window = createWindowMock();
    registerIpcHandlers({
      getWindow: () => window as unknown as BrowserWindow,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });

    // When: TunnelManager publishes status and log callbacks.
    const statusEvent: TunnelStatusChangedEvent = {
      alias: 'dev',
      status: 'error',
      error: 'bind failed',
    };
    const logEvent: TunnelLogEvent = {
      alias: 'dev',
      line: '2026-05-06T00:00:00.000Z bind failed',
    };
    tunnelManagerMock.callbacks?.onStatusChanged(statusEvent);
    tunnelManagerMock.callbacks?.onLog(logEvent);

    // Then: status is forwarded directly and logs keep the preload `data` payload shape.
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.TUNNEL_STATUS_CHANGED, statusEvent);
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.TUNNEL_LOG, {
      alias: 'dev',
      data: '2026-05-06T00:00:00.000Z bind failed',
    });
  });

  it.each([
    { status: 'starting' as const, expected: true },
    { status: 'running' as const, expected: true },
    { status: 'stopped' as const, expected: false },
    { status: 'error' as const, expected: false },
  ])(
    'reports hasActiveTunnelForQuitConfirm=$expected when a tunnel is $status',
    ({ status, expected }) => {
      // Given: TunnelManager.list() reports a single tunnel in the target status.
      tunnelManagerMock.list.mockReturnValue([
        {
          alias: 'dev',
          state: { status, recentLogs: [] },
        },
      ]);
      const handlers = registerIpcHandlers({
        getWindow: () => null,
        settingsStore: createSettingsStore() as unknown as SettingsStore,
      });

      // When/Then: only starting/running statuses request a quit confirmation.
      expect(handlers.hasActiveTunnelForQuitConfirm()).toBe(expected);
    },
  );

  it('reports hasActiveTunnelForQuitConfirm=true when any tunnel is starting or running', () => {
    // Given: a mix of stopped, error, and running tunnels in the runtime list.
    tunnelManagerMock.list.mockReturnValue([
      { alias: 'a', state: { status: 'stopped', recentLogs: [] } },
      { alias: 'b', state: { status: 'error', recentLogs: [] } },
      { alias: 'c', state: { status: 'running', recentLogs: [] } },
    ]);
    const handlers = registerIpcHandlers({
      getWindow: () => null,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });

    // When/Then: at least one running tunnel is enough to require confirmation.
    expect(handlers.hasActiveTunnelForQuitConfirm()).toBe(true);
  });

  it('reports hasActiveTunnelForQuitConfirm=false when no tunnels are present', () => {
    // Given: TunnelManager.list() returns an empty runtime snapshot.
    tunnelManagerMock.list.mockReturnValue([]);
    const handlers = registerIpcHandlers({
      getWindow: () => null,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });

    // When/Then: there is nothing to confirm against.
    expect(handlers.hasActiveTunnelForQuitConfirm()).toBe(false);
  });

  it('forwards PTY signals to the pane info tracker', () => {
    // Given: IPC runtime is registered and ptyManager exposes its callback bundle.
    registerIpcHandlers({
      getWindow: () => null,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });
    expect(ptyManagerMock.callbacks).toBeDefined();

    // When: a runtime signal is observed from PTY output.
    const signal: PaneRuntimeSignal = { type: 'shell-command-started', source: 'osc133' };
    ptyManagerMock.callbacks?.onSignal?.({ id: 'pty-1', signal });

    // Then: the pane info tracker receives the signal as the primary observer.
    expect(paneInfoTrackerMock.applySignal).toHaveBeenCalledWith('pty-1', signal);
  });

  it('forwards PTY user input observations to the pane info tracker', () => {
    // Given: IPC runtime is registered and ptyManager exposes its callback bundle.
    registerIpcHandlers({
      getWindow: () => null,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });
    expect(ptyManagerMock.callbacks).toBeDefined();

    // When: renderer-originated input is written to the PTY.
    ptyManagerMock.callbacks?.onUserInput?.({ id: 'pty-1' });

    // Then: the pane info tracker receives the observation for attention clearing.
    expect(paneInfoTrackerMock.notifyUserInput).toHaveBeenCalledWith('pty-1');
  });

  it('registers created PTYs with the pane info tracker using the resolved cwd', () => {
    // Given: IPC runtime is registered and ptyManager exposes its callback bundle.
    registerIpcHandlers({
      getWindow: () => null,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });
    expect(ptyManagerMock.callbacks).toBeDefined();

    // When: the PTY manager reports a created process with its resolved cwd.
    ptyManagerMock.callbacks?.onCreate?.({
      id: 'pty-1',
      pid: 1234,
      cwd: '/Users/tester',
    });

    // Then: pane runtime tracking is seeded with the same cwd before any OSC 7 arrives.
    expect(paneInfoTrackerMock.register).toHaveBeenCalledWith('pty-1', 1234, '/Users/tester');
  });

  it('drops tunnel events after the current window is destroyed', () => {
    // Given: IPC runtime is registered while the current window is already destroyed.
    const window = createWindowMock(true);
    registerIpcHandlers({
      getWindow: () => window as unknown as BrowserWindow,
      settingsStore: createSettingsStore() as unknown as SettingsStore,
    });

    // When: TunnelManager publishes late callbacks.
    tunnelManagerMock.callbacks?.onStatusChanged({
      alias: 'dev',
      status: 'running',
    });
    tunnelManagerMock.callbacks?.onLog({
      alias: 'dev',
      line: 'late log',
    });

    // Then: no event is sent to the destroyed renderer.
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it('applies the initial shellIntegration.autoInject value to the injector at startup', () => {
    // Given: a settings store that reports auto-inject ON.
    const settingsStore = createSettingsStore();

    // When: IPC runtime is registered (applyRuntimeSettings runs once with the initial settings).
    registerIpcHandlers({
      getWindow: () => null,
      settingsStore: settingsStore as unknown as SettingsStore,
    });

    // Then: the injector receives the persisted value via the initial runtime apply.
    expect(shellIntegrationInjectorMock.setAutoInject).toHaveBeenCalledWith(
      DEFAULT_APP_SETTINGS.shellIntegration.autoInject,
    );
  });

  it('forwards subsequent settings updates to the injector via applyRuntimeSettings', async () => {
    // Given: IPC runtime is registered and `applyRuntimeSettings` is captured from the settings
    // handler registration call.
    const settingsStore = createSettingsStore();
    const { registerSettingsHandlers } = await import('./handlers/settings');
    registerIpcHandlers({
      getWindow: () => null,
      settingsStore: settingsStore as unknown as SettingsStore,
    });
    const settingsHandlerCall = vi.mocked(registerSettingsHandlers).mock.calls.at(-1);
    const applyRuntimeSettings = settingsHandlerCall?.[0]?.applyRuntimeSettings;
    expect(applyRuntimeSettings).toBeDefined();
    shellIntegrationInjectorMock.setAutoInject.mockClear();

    // When: the user disables auto-injection.
    applyRuntimeSettings?.({
      ...DEFAULT_APP_SETTINGS,
      shellIntegration: { autoInject: false },
    });

    // Then: the injector flips off so the next PTY spawn does not auto-inject.
    expect(shellIntegrationInjectorMock.setAutoInject).toHaveBeenCalledWith(false);
  });
});
