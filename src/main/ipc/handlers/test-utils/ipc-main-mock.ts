import { expect, vi } from 'vitest';

export type IpcInvokeHandler = (event: unknown, payload?: unknown) => unknown;

// IMPORTANT: handler test files must import this module before the IPC handler module under test.
// `vi.mock('electron')` is hoisted to the top of this file, but only after this file is evaluated.
// Importing the SUT first would resolve the real `electron.ipcMain` before the mock is installed.
const mocks = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn<(channel: string, listener: IpcInvokeHandler) => void>(),
    removeHandler: vi.fn<(channel: string) => void>(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: mocks.ipcMain,
}));

export const ipcMainMock = mocks.ipcMain;

/**
 * Clears IPC handler registration calls between handler tests.
 */
export function resetIpcMainMock(): void {
  ipcMainMock.handle.mockClear();
  ipcMainMock.removeHandler.mockClear();
}

/**
 * Returns the invoke handler registered for a channel, if the test registered one.
 */
export function getHandler(channel: string): IpcInvokeHandler | undefined {
  return ipcMainMock.handle.mock.calls.find(
    ([registeredChannel]) => registeredChannel === channel,
  )?.[1];
}

/**
 * Returns the invoke handler registered for a channel and fails the test if it is missing.
 */
export function requireHandler(channel: string): IpcInvokeHandler {
  const handler = getHandler(channel);
  expect(handler).toBeDefined();
  return handler as IpcInvokeHandler;
}

/**
 * Asserts that an invalid IPC payload error names the channel without requiring field details.
 */
export function expectInvalidPayload(channel: string, callback: () => unknown): void {
  expect(callback).toThrow(`Invalid IPC payload for ${channel}`);
}
