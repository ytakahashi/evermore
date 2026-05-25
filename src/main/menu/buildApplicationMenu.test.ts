import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBOARD_SHORTCUT_ACTION_IDS,
  getReservedAccelerators,
  type KeyboardShortcutActionId,
  type MenuTemplateNode,
} from '../../shared/keyboard-shortcuts';
import {
  buildApplicationMenu,
  type BuildApplicationMenuOptions,
  type ShortcutDispatchers,
} from './buildApplicationMenu';

function createDispatchers(): {
  dispatchers: ShortcutDispatchers;
  calls: KeyboardShortcutActionId[];
} {
  const calls: KeyboardShortcutActionId[] = [];
  const dispatchers = Object.fromEntries(
    KEYBOARD_SHORTCUT_ACTION_IDS.map((actionId) => [
      actionId,
      (): void => {
        calls.push(actionId);
      },
    ]),
  ) as ShortcutDispatchers;
  return { dispatchers, calls };
}

function defaultOptions(
  overrides: Partial<BuildApplicationMenuOptions> = {},
): BuildApplicationMenuOptions {
  const { dispatchers } = createDispatchers();
  return {
    keybindings: { ...DEFAULT_KEYBINDINGS },
    dispatchers,
    getWindow: () => null,
    openHelp: () => {},
    isDev: false,
    ...overrides,
  };
}

/**
 * Recursively finds the first menu item whose label matches. The template uses Electron's
 * `MenuItemConstructorOptions`, but `submenu` can be either an array or a Menu instance — at
 * template construction time it is always an array, which is what we assert on.
 */
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

describe('buildApplicationMenu', () => {
  it('renders Evermore action items with the resolved accelerator from keybindings', () => {
    // Given: a custom keybinding overrides one default.
    const options = defaultOptions({
      keybindings: { ...DEFAULT_KEYBINDINGS, 'workspace.newTab': 'Command+Shift+T' },
    });

    // When: the template is built.
    const template = buildApplicationMenu(options);

    // Then: each Evermore action surfaces with its expected accelerator.
    expect(findItemByLabel(template, 'New Tab')?.accelerator).toBe('Command+Shift+T');
    expect(findItemByLabel(template, 'Close Tab')?.accelerator).toBe(
      DEFAULT_KEYBINDINGS['workspace.closeTab'],
    );
    expect(findItemByLabel(template, 'Preferences…')?.accelerator).toBe(
      DEFAULT_KEYBINDINGS['ui.openSettings'],
    );
    expect(findItemByLabel(template, 'Focus Left Pane')?.accelerator).toBe(
      DEFAULT_KEYBINDINGS['pane.focusLeft'],
    );
  });

  it('drops the accelerator for explicit unbinds while keeping the click handler', () => {
    // Given: the user explicitly unbinds an action.
    const { dispatchers, calls } = createDispatchers();
    const options = defaultOptions({
      keybindings: { ...DEFAULT_KEYBINDINGS, 'workspace.newTab': '' },
      dispatchers,
    });

    // When: the template is built and the menu item is clicked.
    const template = buildApplicationMenu(options);
    const newTab = findItemByLabel(template, 'New Tab');
    type ClickHandler = NonNullable<MenuItemConstructorOptions['click']>;
    (newTab?.click as ClickHandler)(
      // @ts-expect-error click args are not used by the handler
      undefined,
      undefined,
      undefined,
    );

    // Then: the accelerator is undefined but the action still dispatches via click.
    expect(newTab?.accelerator).toBeUndefined();
    expect(calls).toEqual(['workspace.newTab']);
  });

  it('omits the DevTools entry in production builds', () => {
    // Given: a production-mode template.
    const template = buildApplicationMenu(defaultOptions({ isDev: false }));

    // Then: View menu has no Toggle Developer Tools entry.
    const viewMenu = template.find((item) => item.label === 'View');
    expect(Array.isArray(viewMenu?.submenu)).toBe(true);
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    expect(submenu.some((item) => item.role === 'toggleDevTools')).toBe(false);
  });

  it('includes the DevTools entry in development builds', () => {
    // Given: a dev-mode template.
    const template = buildApplicationMenu(defaultOptions({ isDev: true }));

    // Then: View menu exposes the role-based DevTools toggle.
    const viewMenu = template.find((item) => item.label === 'View');
    const submenu = viewMenu?.submenu as MenuItemConstructorOptions[];
    expect(submenu.some((item) => item.role === 'toggleDevTools')).toBe(true);
  });

  it('renders Close Window as a custom item without accelerator or role', () => {
    // Given: a window resolver that returns a stub with a `close()` spy.
    const close = vi.fn();
    const fakeWindow = { close } as unknown as BrowserWindow;
    const template = buildApplicationMenu(defaultOptions({ getWindow: () => fakeWindow }));

    // When: the Close Window menu item is located and clicked.
    const closeWindow = findItemByLabel(template, 'Close Window');
    type ClickHandler = NonNullable<MenuItemConstructorOptions['click']>;
    (closeWindow?.click as ClickHandler)(
      // @ts-expect-error click args are not used by the handler
      undefined,
      undefined,
      undefined,
    );

    // Then: it has neither a role nor a Cmd+W accelerator, and forwards to the injected window.
    expect(closeWindow?.role).toBeUndefined();
    expect(closeWindow?.accelerator).toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not throw when Close Window is clicked while no window is available', () => {
    // Given: the resolver returns null (the window was already destroyed).
    const template = buildApplicationMenu(defaultOptions({ getWindow: () => null }));
    const closeWindow = findItemByLabel(template, 'Close Window');

    // When / Then: clicking is a safe no-op.
    type ClickHandler = NonNullable<MenuItemConstructorOptions['click']>;
    expect(() =>
      (closeWindow?.click as ClickHandler)(
        // @ts-expect-error click args are not used by the handler
        undefined,
        undefined,
        undefined,
      ),
    ).not.toThrow();
  });

  it('exposes the full set of Evermore-action accelerators plus standard role bindings via getReservedAccelerators', () => {
    // Given: the production template with default keybindings.
    const template = buildApplicationMenu(defaultOptions());

    // When: the reserved accelerator set is derived from the template.
    const reserved = getReservedAccelerators(template as readonly MenuTemplateNode[]);

    // Then: every Evermore action's default accelerator is present.
    for (const actionId of KEYBOARD_SHORTCUT_ACTION_IDS) {
      expect(reserved.has(DEFAULT_KEYBINDINGS[actionId])).toBe(true);
    }

    // And: the standard macOS role accelerators must surface too — these are the conflict source
    // the Settings UI warns against (e.g. trying to rebind an Evermore action to Cmd+C).
    // Strings use the renderer's canonical modifier order (`Command` → `Control` → `Option` →
    // `Shift`) so exact-equality conflict checks line up with what the Settings UI's accelerator
    // picker produces.
    const standardRoleAccelerators = [
      'Command+Z',
      'Command+Shift+Z',
      'Command+X',
      'Command+C',
      'Command+V',
      'Command+A',
      'Command+Q',
      'Command+H',
      'Command+Option+H',
      'Command+M',
      'Command+Control+F',
    ];
    for (const accelerator of standardRoleAccelerators) {
      expect(reserved.has(accelerator)).toBe(true);
    }
  });

  it('includes the DevTools accelerator in the reserved set only in dev mode', () => {
    // Given: dev and production templates.
    const dev = buildApplicationMenu(defaultOptions({ isDev: true }));
    const prod = buildApplicationMenu(defaultOptions({ isDev: false }));

    // When / Then: the DevTools accelerator only appears when the menu item is rendered.
    expect(
      getReservedAccelerators(dev as readonly MenuTemplateNode[]).has('Command+Option+I'),
    ).toBe(true);
    expect(
      getReservedAccelerators(prod as readonly MenuTemplateNode[]).has('Command+Option+I'),
    ).toBe(false);
  });

  it('renders a Help menu with a Learn More item that forwards to the injected callback', () => {
    // Given: a spy on the Help → Learn More click handler.
    const openHelp = vi.fn();
    const template = buildApplicationMenu(defaultOptions({ openHelp }));

    // Then: the Help menu is the last top-level entry and exposes Learn More.
    const helpMenu = template.at(-1);
    expect(helpMenu?.label).toBe('Help');
    expect(helpMenu?.role).toBe('help');

    const learnMore = findItemByLabel(template, 'Learn More');
    expect(learnMore).not.toBeNull();
    // The item must not own a global accelerator — Help items are click-only in our menu.
    expect(learnMore?.accelerator).toBeUndefined();

    // When: the Learn More click handler runs.
    type ClickHandler = NonNullable<MenuItemConstructorOptions['click']>;
    (learnMore?.click as ClickHandler)(
      // @ts-expect-error click args are not used by the handler
      undefined,
      undefined,
      undefined,
    );

    // Then: the injected callback fires.
    expect(openHelp).toHaveBeenCalledOnce();
  });
});
