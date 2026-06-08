import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../shared/ipc-channels';
import type { PtyManager } from '../../pty/pty-manager';
import type { PtyCreateOptions } from '../../pty/types';
import {
  MAX_ID_LENGTH,
  MAX_PATH_LENGTH,
  MAX_PTY_DIMENSION,
  MAX_PTY_WRITE_LENGTH,
} from '../validation';
import {
  expectInvalidPayload,
  ipcMainMock,
  requireHandler,
  resetIpcMainMock,
} from './test-utils/ipc-main-mock';
import { registerPtyHandlers } from './pty';

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

function registerWithPtyManager(): TestPtyManager {
  const ptyManager = createPtyManager();
  registerPtyHandlers({
    getWindow: () => null,
    ptyManager: ptyManager as unknown as PtyManager,
  });
  return ptyManager;
}

const invalidResizeDimensions: Array<[string, 'cols' | 'rows', number]> = [
  ['cols zero', 'cols', 0],
  ['cols negative', 'cols', -1],
  ['cols fraction', 'cols', 1.5],
  ['cols NaN', 'cols', Number.NaN],
  ['cols Infinity', 'cols', Infinity],
  ['cols -Infinity', 'cols', -Infinity],
  ['cols over limit', 'cols', MAX_PTY_DIMENSION + 1],
  ['rows zero', 'rows', 0],
  ['rows negative', 'rows', -1],
  ['rows fraction', 'rows', 1.5],
  ['rows NaN', 'rows', Number.NaN],
  ['rows Infinity', 'rows', Infinity],
  ['rows -Infinity', 'rows', -Infinity],
  ['rows over limit', 'rows', MAX_PTY_DIMENSION + 1],
];

describe('registerPtyHandlers', () => {
  beforeEach(() => {
    resetIpcMainMock();
  });

  it('forwards only public PTY create fields to the manager', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = createPtyManager();
    registerPtyHandlers({
      getWindow: () => null,
      ptyManager: ptyManager as unknown as PtyManager,
    });

    // When: a renderer payload includes internal-only manager options as extra keys.
    const result = requireHandler(IPC.PTY_CREATE)(
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
    requireHandler(IPC.PTY_CREATE)({}, { cwd: '/Users/tester/project' });

    // Then: the manager receives the minimal internal create options.
    expect(ptyManager.create).toHaveBeenCalledWith({
      cwd: '/Users/tester/project',
    });
  });

  it('allows an empty PTY create cwd while still reconstructing manager options', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When: a renderer requests the existing home-directory fallback behavior.
    requireHandler(IPC.PTY_CREATE)({}, { cwd: '' });

    // Then: the empty cwd is forwarded as the public create input.
    expect(ptyManager.create).toHaveBeenCalledWith({
      cwd: '',
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
    requireHandler(IPC.PTY_WRITE)({}, { id: 'pty-1', data: 'pwd\r' });
    requireHandler(IPC.PTY_RESIZE)({}, { id: 'pty-1', cols: 132, rows: 43 });
    requireHandler(IPC.PTY_DISPOSE)({}, { id: 'pty-1' });

    // Then: requests are bridged to the manager.
    expect(ptyManager.write).toHaveBeenCalledWith('pty-1', 'pwd\r');
    expect(ptyManager.resize).toHaveBeenCalledWith('pty-1', 132, 43);
    expect(ptyManager.dispose).toHaveBeenCalledWith('pty-1');
  });

  it('allows empty PTY writes and ignores extra write payload keys', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When: a renderer sends an empty write with unrelated extra keys.
    requireHandler(IPC.PTY_WRITE)({}, { id: 'pty-1', data: '', shell: '/bin/bash' });

    // Then: only the validated id and data reach the manager.
    expect(ptyManager.write).toHaveBeenCalledWith('pty-1', '');
  });

  it('ignores extra PTY resize payload keys', () => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When: a renderer sends resize dimensions with unrelated extra keys.
    requireHandler(IPC.PTY_RESIZE)({}, { id: 'pty-1', cols: 132, rows: 43, env: {} });

    // Then: only the validated resize fields reach the manager.
    expect(ptyManager.resize).toHaveBeenCalledWith('pty-1', 132, 43);
  });

  it.each([
    ['non-object', null],
    ['missing cwd', {}],
    ['undefined cwd', { cwd: undefined }],
    ['wrong-type cwd', { cwd: 1 }],
    ['over-limit cwd', { cwd: 'x'.repeat(MAX_PATH_LENGTH + 1) }],
    ['empty paneId', { cwd: '/Users/tester/project', paneId: '' }],
    ['wrong-type paneId', { cwd: '/Users/tester/project', paneId: 1 }],
    ['over-limit paneId', { cwd: '/Users/tester/project', paneId: 'x'.repeat(MAX_ID_LENGTH + 1) }],
  ])('rejects invalid PTY create payloads: %s', (_label: string, payload: unknown) => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When / Then: the malformed payload is rejected before creating a PTY.
    expectInvalidPayload(IPC.PTY_CREATE, () => requireHandler(IPC.PTY_CREATE)({}, payload));
    expect(ptyManager.create).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object', null],
    ['missing id', { data: 'pwd\r' }],
    ['empty id', { id: '', data: 'pwd\r' }],
    ['wrong-type id', { id: 1, data: 'pwd\r' }],
    ['over-limit id', { id: 'x'.repeat(MAX_ID_LENGTH + 1), data: 'pwd\r' }],
    ['missing data', { id: 'pty-1' }],
    ['wrong-type data', { id: 'pty-1', data: 1 }],
    ['over-limit data', { id: 'pty-1', data: 'x'.repeat(MAX_PTY_WRITE_LENGTH + 1) }],
  ])('rejects invalid PTY write payloads: %s', (_label: string, payload: unknown) => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When / Then: the malformed payload is rejected before writing to the PTY.
    expectInvalidPayload(IPC.PTY_WRITE, () => requireHandler(IPC.PTY_WRITE)({}, payload));
    expect(ptyManager.write).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object', null],
    ['missing id', { cols: 80, rows: 24 }],
    ['empty id', { id: '', cols: 80, rows: 24 }],
    ['wrong-type id', { id: 1, cols: 80, rows: 24 }],
    ['over-limit id', { id: 'x'.repeat(MAX_ID_LENGTH + 1), cols: 80, rows: 24 }],
  ])('rejects invalid PTY resize id payloads: %s', (_label: string, payload: unknown) => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When / Then: the malformed payload is rejected before resizing the PTY.
    expectInvalidPayload(IPC.PTY_RESIZE, () => requireHandler(IPC.PTY_RESIZE)({}, payload));
    expect(ptyManager.resize).not.toHaveBeenCalled();
  });

  it.each(invalidResizeDimensions)(
    'rejects invalid PTY resize dimensions: %s',
    (_label: string, field: 'cols' | 'rows', value: number) => {
      // Given: PTY handlers are registered with an injected manager.
      const ptyManager = registerWithPtyManager();
      const payload = { id: 'pty-1', cols: 80, rows: 24, [field]: value };

      // When / Then: the malformed dimension is rejected before resizing the PTY.
      expectInvalidPayload(IPC.PTY_RESIZE, () => requireHandler(IPC.PTY_RESIZE)({}, payload));
      expect(ptyManager.resize).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['non-object', null],
    ['missing id', {}],
    ['undefined id', { id: undefined }],
    ['empty id', { id: '' }],
    ['wrong-type id', { id: 1 }],
    ['over-limit id', { id: 'x'.repeat(MAX_ID_LENGTH + 1) }],
  ])('rejects invalid PTY dispose payloads: %s', (_label: string, payload: unknown) => {
    // Given: PTY handlers are registered with an injected manager.
    const ptyManager = registerWithPtyManager();

    // When / Then: the malformed payload is rejected before disposing the PTY.
    expectInvalidPayload(IPC.PTY_DISPOSE, () => requireHandler(IPC.PTY_DISPOSE)({}, payload));
    expect(ptyManager.dispose).not.toHaveBeenCalled();
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
