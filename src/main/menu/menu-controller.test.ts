import type { MenuItemConstructorOptions } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc-channels';
import { DEFAULT_KEYBINDINGS } from '../../shared/keyboard-shortcuts';
import { SettingsStore } from '../settings/settings-store';
import type { PersistedSettings, SettingsStorageAdapter } from '../settings/types';
import { createMenuController } from './menu-controller';
import { createShortcutDispatcher } from './dispatcher';

class MemorySettingsStorageAdapter implements SettingsStorageAdapter {
  public payload: unknown;

  public constructor(initial: unknown = {}) {
    this.payload = initial;
  }

  public getSettings(): unknown {
    return this.payload;
  }

  public setSettings(settings: PersistedSettings): void {
    this.payload = settings;
  }

  public getFilePath(): string {
    return '/tmp/evermore/settings.json';
  }
}

function findItemByLabel(
  template: readonly MenuItemConstructorOptions[],
  label: string,
): MenuItemConstructorOptions | null {
  for (const item of template) {
    if (item.label === label) {
      return item;
    }
    if (Array.isArray(item.submenu)) {
      const found = findItemByLabel(item.submenu, label);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

describe('createMenuController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds the menu synchronously on startup', () => {
    // Given: a settings store at defaults and a sink for the rendered template.
    const settingsStore = new SettingsStore({ storage: new MemorySettingsStorageAdapter() });
    const setApplicationMenu = vi.fn();

    // When: the controller is created.
    const controller = createMenuController({
      settingsStore,
      dispatchers: createShortcutDispatcher(() => null),
      getWindow: () => null,
      openHelp: () => {},
      isDev: false,
      setApplicationMenu,
    });

    // Then: the initial template reaches the sink with the default accelerators applied.
    expect(setApplicationMenu).toHaveBeenCalledOnce();
    const [template] = setApplicationMenu.mock.calls[0] as [MenuItemConstructorOptions[]];
    expect(findItemByLabel(template, 'New Tab')?.accelerator).toBe(
      DEFAULT_KEYBINDINGS['workspace.newTab'],
    );
    controller.dispose();
  });

  it('coalesces back-to-back keybinding changes into a single debounced rebuild', () => {
    // Given: a controller with a short debounce window so we can drive the timer manually.
    const settingsStore = new SettingsStore({ storage: new MemorySettingsStorageAdapter() });
    const setApplicationMenu = vi.fn();
    const controller = createMenuController({
      settingsStore,
      dispatchers: createShortcutDispatcher(() => null),
      getWindow: () => null,
      openHelp: () => {},
      isDev: false,
      setApplicationMenu,
      debounceMs: 50,
    });
    setApplicationMenu.mockClear();

    // When: two keybinding updates fire within the debounce window.
    settingsStore.update({
      shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+T' } },
    });
    settingsStore.update({
      shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+N' } },
    });
    // Before the timer fires, no rebuild has run yet.
    expect(setApplicationMenu).not.toHaveBeenCalled();

    // Then: after the debounce window elapses, a single rebuild reflects the latest accelerator.
    vi.advanceTimersByTime(50);
    expect(setApplicationMenu).toHaveBeenCalledOnce();
    const [template] = setApplicationMenu.mock.calls[0] as [MenuItemConstructorOptions[]];
    expect(findItemByLabel(template, 'New Tab')?.accelerator).toBe('Command+Shift+N');
    controller.dispose();
  });

  it('does not rebuild when a settings update leaves keybindings unchanged', () => {
    // Given: a controller observing a settings store at defaults.
    const settingsStore = new SettingsStore({ storage: new MemorySettingsStorageAdapter() });
    const setApplicationMenu = vi.fn();
    const controller = createMenuController({
      settingsStore,
      dispatchers: createShortcutDispatcher(() => null),
      getWindow: () => null,
      openHelp: () => {},
      isDev: false,
      setApplicationMenu,
      debounceMs: 50,
    });
    setApplicationMenu.mockClear();

    // When: a non-shortcut section is updated.
    settingsStore.update({ terminal: { cursorStyle: 'underline' } });
    vi.advanceTimersByTime(50);

    // Then: the menu is not rebuilt — the keybinding diff filter short-circuits.
    expect(setApplicationMenu).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('dispatches webContents.send when a menu action click handler fires', () => {
    // Given: a fake window whose webContents.send tracks dispatched shortcut payloads.
    const send = vi.fn();
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send },
    };
    const settingsStore = new SettingsStore({ storage: new MemorySettingsStorageAdapter() });
    const setApplicationMenu = vi.fn();
    const dispatchers = createShortcutDispatcher(
      () => fakeWindow as unknown as Electron.BrowserWindow,
    );
    const controller = createMenuController({
      settingsStore,
      dispatchers,
      getWindow: () => fakeWindow as unknown as Electron.BrowserWindow,
      openHelp: () => {},
      isDev: false,
      setApplicationMenu,
    });
    const [template] = setApplicationMenu.mock.calls[0] as [MenuItemConstructorOptions[]];

    // When: the New Tab click handler is invoked by the menu system.
    const newTab = findItemByLabel(template, 'New Tab');
    type ClickHandler = NonNullable<MenuItemConstructorOptions['click']>;
    (newTab?.click as ClickHandler)(
      // @ts-expect-error click args are not used by the handler
      undefined,
      undefined,
      undefined,
    );

    // Then: the dispatcher forwards the action id over IPC.
    expect(send).toHaveBeenCalledWith(IPC.SHORTCUT_INVOKE, { actionId: 'workspace.newTab' });
    controller.dispose();
  });

  it('dispose() cancels a pending rebuild and stops further dispatches', () => {
    // Given: a controller with a pending debounce timer queued by a keybinding update.
    const settingsStore = new SettingsStore({ storage: new MemorySettingsStorageAdapter() });
    const setApplicationMenu = vi.fn();
    const controller = createMenuController({
      settingsStore,
      dispatchers: createShortcutDispatcher(() => null),
      getWindow: () => null,
      openHelp: () => {},
      isDev: false,
      setApplicationMenu,
      debounceMs: 50,
    });
    setApplicationMenu.mockClear();
    settingsStore.update({
      shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+T' } },
    });

    // When: dispose runs before the debounce window elapses.
    controller.dispose();
    vi.advanceTimersByTime(50);

    // Then: the queued rebuild is dropped and no further subscriber callbacks reach the menu.
    expect(setApplicationMenu).not.toHaveBeenCalled();
    settingsStore.update({
      shortcuts: { keybindings: { 'workspace.newTab': 'Command+Shift+N' } },
    });
    vi.advanceTimersByTime(50);
    expect(setApplicationMenu).not.toHaveBeenCalled();
  });
});
