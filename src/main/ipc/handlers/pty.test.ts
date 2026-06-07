import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { PtyManager } from '../../pty/pty-manager';
import type { PtyCreateOptions } from '../../pty/types';
import { registerPtyHandlers } from './pty';

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}));

function getHandler(channel: string): ((event: unknown, payload?: unknown) => unknown) | undefined {
  return ipcMainMock.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1];
}

interface TestPtyManager {
  create: ReturnType<typeof vi.fn<(options: PtyCreateOptions) => string>>;
  write: ReturnType<typeof vi.fn<(id: string, data: string) => void>>;
  resize: ReturnType<typeof vi.fn<(id: string, cols: number, rows: number) => void>>;
  dispose: ReturnType<typeof vi.fn<(id: string) => void>>;
  disposeAll: ReturnType<typeof vi.fn<() => void>>;
}

function createPtyManager(): TestPtyManager {
  return {
    create: vi.fn(() => 'pty-1'),
    write: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    disposeAll: vi.fn(),
  };
}

describe('registerPtyHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it('forwards only public PTY create fields to the manager', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = createPtyManager();
    registerPtyHandlers({
      getWindow: () => null,
      ptyManager: ptyManager as unknown as PtyManager,
    });

    // When: a renderer payload includes internal-only manager options as extra keys.
    const result = getHandler(IPC.PTY_CREATE)?.(
      {},
      {
        cwd: '/Users/tester/project',
        paneId: 'pane-1',
        shell: '/bin/bash',
        env: { SECRET: 'value' },
        cols: 200,
        rows: 100,
      },
    );

    // Then: only the public request fields reach the internal PTY manager.
    expect(result).toBe('pty-1');
    expect(ptyManager.create).toHaveBeenCalledWith({
      cwd: '/Users/tester/project',
      paneId: 'pane-1',
    });
  });

  it('creates a PTY without a pane id when the optional field is omitted', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = createPtyManager();
    registerPtyHandlers({
      getWindow: () => null,
      ptyManager: ptyManager as unknown as PtyManager,
    });

    // When: a renderer requests a PTY without associating it with a pane.
    getHandler(IPC.PTY_CREATE)?.({}, { cwd: '/Users/tester/project' });

    // Then: the manager receives the minimal internal create options.
    expect(ptyManager.create).toHaveBeenCalledWith({
      cwd: '/Users/tester/project',
    });
  });

  it('delegates PTY write, resize, and dispose requests to the manager', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = createPtyManager();
    registerPtyHandlers({
      getWindow: () => null,
      ptyManager: ptyManager as unknown as PtyManager,
    });

    // When: renderer lifecycle handlers are invoked.
    getHandler(IPC.PTY_WRITE)?.({}, { id: 'pty-1', data: 'pwd\r' });
    getHandler(IPC.PTY_RESIZE)?.({}, { id: 'pty-1', cols: 132, rows: 43 });
    getHandler(IPC.PTY_DISPOSE)?.({}, { id: 'pty-1' });

    // Then: requests are bridged to the manager.
    expect(ptyManager.write).toHaveBeenCalledWith('pty-1', 'pwd\r');
    expect(ptyManager.resize).toHaveBeenCalledWith('pty-1', 132, 43);
    expect(ptyManager.dispose).toHaveBeenCalledWith('pty-1');
  });

  it('removes handlers and disposes all PTYs during teardown', () => {
    // Given: PTY handlers have been registered.
    const ptyManager = createPtyManager();
    const dispose = registerPtyHandlers({
      getWindow: () => null,
      ptyManager: ptyManager as unknown as PtyManager,
    });

    // When: registration is disposed.
    dispose();

    // Then: all handlers and runtime PTYs are cleaned up.
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PTY_CREATE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PTY_WRITE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PTY_RESIZE);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith(IPC.PTY_DISPOSE);
    expect(ptyManager.disposeAll).toHaveBeenCalledOnce();
  });
});
