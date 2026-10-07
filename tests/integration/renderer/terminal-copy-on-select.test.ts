import { createElement } from 'react';
import { Terminal } from '@xterm/xterm';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_APP_SETTINGS } from '../../../src/shared/settings-defaults';
import type { Api } from '../../../src/shared/api-types';
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore';
import { useTerminal } from '../../../src/renderer/src/components/terminal/useTerminal';

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    public readonly activate = vi.fn();
    public readonly dispose = vi.fn();
    public readonly fit = vi.fn();
    public proposeDimensions(): { cols: number; rows: number } {
      return { cols: 80, rows: 24 };
    }
  },
}));
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    public readonly activate = vi.fn();
    public readonly dispose = vi.fn();
  },
}));

function Harness(): ReturnType<typeof createElement> {
  const { containerRef } = useTerminal({ cwd: '/tmp' });
  return createElement('div', { ref: containerRef });
}

describe('command blocks with hook copy-on-select enabled', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('does not write clipboard text until an explicit block copy', async () => {
    // Given: the actual hook and attachment share a real xterm parser and copy-on-select is enabled.
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const originalApi = window.api;
    const settings = structuredClone(DEFAULT_APP_SETTINGS);
    settings.terminal.copyOnSelect = true;
    useSettingsStore.setState({ settings });
    const clipboard = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboard },
    });
    window.api = {
      pty: {
        create: vi.fn(() => Promise.resolve('pty-test')),
        write: vi.fn(() => Promise.resolve()),
        resize: vi.fn(() => Promise.resolve()),
        dispose: vi.fn(() => Promise.resolve()),
        onData: vi.fn(() => () => undefined),
        onExit: vi.fn(() => () => undefined),
      },
    } as unknown as Api;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public readonly observe = vi.fn();
        public readonly disconnect = vi.fn();
      },
    );
    const terminals: Terminal[] = [];
    // Display adapters are omitted in jsdom; xterm parsing, markers, history, and events remain real.
    vi.spyOn(Terminal.prototype, 'open').mockImplementation(function (this: Terminal) {
      terminals.push(this);
    });
    const handlers = vi.spyOn(Terminal.prototype, 'attachCustomKeyEventHandler');
    const select = vi.spyOn(Terminal.prototype, 'select');
    const { unmount } = render(createElement(Harness));
    try {
      await waitFor(() => expect(window.api.pty.create).toHaveBeenCalled());
      const terminal = terminals[0];
      if (!terminal) {
        throw new Error('Expected the hook to own a terminal');
      }
      await new Promise<void>((resolve) =>
        terminal?.write(
          '\x1b]133;A\x07\x1b]133;B\x07$ echo result\r\n' +
            '\x1b]633;E;echo result\x07\x1b]133;C\x07result\r\n\x1b]133;D;0\x07' +
            '\x1b]133;A\x07\x1b]133;B\x07$ ',
          resolve,
        ),
      );
      const handler = handlers.mock.calls[0]?.[0];

      // When: keyboard navigation highlights a block, then the explicit copy shortcut follows.
      handler?.(new KeyboardEvent('keydown', { key: 'ArrowUp', metaKey: true }));
      expect(clipboard).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      handler?.(
        new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', metaKey: true, shiftKey: true }),
      );

      // Then: copy-on-select has not added a second clipboard write or altered the PTY input.
      await waitFor(() =>
        expect(clipboard).toHaveBeenCalledExactlyOnceWith('$ echo result\nresult'),
      );
      expect(window.api.pty.write).not.toHaveBeenCalled();
    } finally {
      unmount();
      window.api = originalApi;
      useSettingsStore.setState({ settings: structuredClone(DEFAULT_APP_SETTINGS) });
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });
});
