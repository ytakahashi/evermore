import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi, type Mock } from 'vite-plus/test';
import { HotkeyManager } from './hotkey-manager';

// The mocks are returned alongside the window so assertions reference them directly rather than
// through `BrowserWindow` methods, which `typescript/unbound-method` rejects.
function createWindow(): {
  window: BrowserWindow;
  show: Mock<() => void>;
  focus: Mock<() => void>;
} {
  const show = vi.fn<() => void>();
  const focus = vi.fn<() => void>();
  const window = {
    focus,
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show,
  } as unknown as BrowserWindow;
  return { window, show, focus };
}

describe('HotkeyManager', () => {
  it('registers a hotkey and focuses the current window when invoked', () => {
    // Given: global shortcut registration succeeds.
    const { window, show, focus } = createWindow();
    const callbacks: Array<() => void> = [];
    const onWindowReveal = vi.fn();
    const register = vi.fn((_accelerator: string, nextCallback: () => void) => {
      callbacks.push(nextCallback);
      return true;
    });
    const manager = new HotkeyManager({
      getWindow: () => window,
      onWindowReveal,
      register,
      unregister: vi.fn(),
    });

    // When: a hotkey is applied and Electron invokes it.
    const accepted = manager.set('Command+Shift+,');
    callbacks[0]?.();

    // Then: the accelerator is accepted and the window is brought forward.
    expect(accepted).toBe('Command+Shift+,');
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    expect(onWindowReveal).toHaveBeenCalledOnce();
    expect(onWindowReveal.mock.invocationCallOrder[0]).toBeLessThan(
      show.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('keeps the previous accelerator when the requested one fails to register', () => {
    // Given: the first registration succeeds and the second fails.
    const register = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const unregister = vi.fn();
    const manager = new HotkeyManager({
      getWindow: () => null,
      register,
      unregister,
    });

    // When: a new accelerator is rejected by Electron.
    manager.set('Command+Shift+,');
    const accepted = manager.set('Command+Shift+Space');

    // Then: the manager restores and reports the last working accelerator.
    expect(accepted).toBe('Command+Shift+,');
    expect(unregister).toHaveBeenCalledWith('Command+Shift+,');
    expect(register).toHaveBeenLastCalledWith('Command+Shift+,', expect.any(Function));
  });

  it('unregisters the owned accelerator when disabled', () => {
    // Given: a registered accelerator.
    const unregister = vi.fn();
    const manager = new HotkeyManager({
      getWindow: () => null,
      register: vi.fn(() => true),
      unregister,
    });
    manager.set('Command+Shift+,');

    // When: the hotkey is disabled.
    const accepted = manager.set(null);

    // Then: the owned accelerator is unregistered.
    expect(accepted).toBeNull();
    expect(unregister).toHaveBeenCalledWith('Command+Shift+,');
  });
});
