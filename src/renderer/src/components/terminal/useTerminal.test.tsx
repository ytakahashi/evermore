import { render, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings-defaults';
import type { AppSettings } from '../../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTerminal } from './useTerminal';

const xtermMock = vi.hoisted(() => {
  const terminalInstances: MockTerminal[] = [];
  const fitAddonInstances: MockFitAddon[] = [];

  class MockTerminal {
    public readonly cols = 132;
    public readonly rows = 43;
    public readonly loadAddon = vi.fn();
    public readonly open = vi.fn();
    public readonly write = vi.fn();
    public readonly writeln = vi.fn();
    public readonly dispose = vi.fn();
    public readonly focus = vi.fn();
    public readonly attachCustomKeyEventHandler = vi.fn(
      (handler: (event: KeyboardEvent) => boolean) => {
        this.customKeyEventHandler = handler;
      },
    );
    public readonly inputDisposable = { dispose: vi.fn() };
    public readonly selectionChangeDisposable = {
      dispose: vi.fn(() => {
        this.selectionChangeListener = null;
      }),
    };
    public options: Record<string, unknown>;
    public readonly unicode = { activeVersion: '6' };
    private customKeyEventHandler: ((event: KeyboardEvent) => boolean) | null = null;
    private inputListener: ((data: string) => void) | null = null;
    private selection = '';
    private selectionChangeListener: (() => void) | null = null;

    public constructor(options: Record<string, unknown>) {
      this.options = { ...options };
      terminalInstances.push(this);
    }

    public onData(listener: (data: string) => void): { dispose: () => void } {
      this.inputListener = listener;
      return this.inputDisposable;
    }

    public emitInput(data: string): void {
      this.inputListener?.(data);
    }

    public onSelectionChange(listener: () => void): { dispose: () => void } {
      this.selectionChangeListener = listener;
      return this.selectionChangeDisposable;
    }

    public getSelection(): string {
      return this.selection;
    }

    public emitSelectionChange(selection: string): void {
      this.selection = selection;
      this.selectionChangeListener?.();
    }

    public evaluateCustomKey(event: KeyboardEvent): boolean | null {
      return this.customKeyEventHandler?.(event) ?? null;
    }
  }

  class MockFitAddon {
    public readonly fit = vi.fn();
    public readonly proposeDimensions = vi.fn(() => ({ cols: 132, rows: 43 }));

    public constructor() {
      fitAddonInstances.push(this);
    }
  }

  return {
    terminalInstances,
    fitAddonInstances,
    MockTerminal,
    MockFitAddon,
    MockWebLinksAddon: class MockWebLinksAddon {},
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: xtermMock.MockTerminal,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: xtermMock.MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: xtermMock.MockWebLinksAddon,
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class MockUnicode11Addon {},
}));

interface PtyApiMock {
  create: ReturnType<typeof vi.fn<(options: { cwd: string; shell?: string }) => Promise<string>>>;
  write: ReturnType<typeof vi.fn<(id: string, data: string) => Promise<void>>>;
  resize: ReturnType<typeof vi.fn<(id: string, cols: number, rows: number) => Promise<void>>>;
  dispose: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
  onData: ReturnType<typeof vi.fn<(cb: (id: string, data: string) => void) => () => void>>;
  onExit: ReturnType<typeof vi.fn<(cb: (id: string, code: number) => void) => () => void>>;
}

interface TestTerminalProps {
  cwd?: string;
  initialCommand?: string;
  isActive?: boolean;
  onPtyIdChange?: (ptyId: string | null) => void;
}

function TestTerminal({
  cwd = '/Users/tester/project',
  initialCommand,
  isActive = true,
  onPtyIdChange,
}: TestTerminalProps): React.JSX.Element {
  const { containerRef } = useTerminal({
    cwd,
    initialCommand,
    isActive,
    onPtyIdChange,
    shell: '/bin/zsh',
  });

  return <div ref={containerRef} />;
}

describe('useTerminal', () => {
  let ptyApi: PtyApiMock;
  let paneInfoApi: Pick<Window['api']['paneInfo'], 'notifyCommand'>;
  let dataCleanup: Mock<() => void>;
  let exitCleanup: Mock<() => void>;
  let exitListener: ((id: string, code: number) => void) | null;
  let dataListener: ((id: string, data: string) => void) | null;
  let resizeObserverCallback: (() => void) | null;
  let clipboardWriteText: Mock<(text: string) => Promise<void>>;

  function setTerminalSettings(terminal: Partial<AppSettings['terminal']>): void {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        terminal: {
          ...DEFAULT_APP_SETTINGS.terminal,
          ...terminal,
        },
      },
    });
  }

  beforeEach(() => {
    dataCleanup = vi.fn<() => void>();
    exitCleanup = vi.fn<() => void>();
    dataListener = null;
    exitListener = null;
    resizeObserverCallback = null;
    xtermMock.terminalInstances.length = 0;
    xtermMock.fitAddonInstances.length = 0;
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      isLoading: false,
      error: null,
    });
    clipboardWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });

    ptyApi = {
      create: vi.fn(() => Promise.resolve('pty-1')),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(() => Promise.resolve()),
      onData: vi.fn((cb) => {
        dataListener = cb;
        return dataCleanup;
      }),
      onExit: vi.fn((cb) => {
        exitListener = cb;
        return exitCleanup;
      }),
    };
    paneInfoApi = {
      notifyCommand: vi.fn(() => Promise.resolve()),
    };

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { paneInfo: paneInfoApi, pty: ptyApi },
    });

    class MockResizeObserver implements ResizeObserver {
      public readonly observe = vi.fn();
      public readonly unobserve = vi.fn();
      public readonly disconnect = vi.fn();

      public constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = () => {
          callback([], this);
        };
      }
    }

    globalThis.ResizeObserver = MockResizeObserver;

    // Mock document.fonts
    if (typeof document !== 'undefined') {
      let resolveFontsReady: () => void;
      const fontsReady = new Promise<void>((resolve) => {
        resolveFontsReady = resolve;
      });
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: {
          ready: fontsReady,
          _resolve: () => resolveFontsReady(),
        },
      });
    }
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    if (typeof document !== 'undefined') {
      Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('creates a PTY when the terminal mounts and resizes it after creation', async () => {
    // Given: xterm.js and the preload PTY API are mocked.

    // When: a terminal pane mounts.
    render(<TestTerminal />);

    // Then: the hook creates a PTY for the pane and syncs xterm dimensions to main.
    // 132 cols and 43 rows match MockTerminal.cols/rows — the PTY receives the xterm size as-is.
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalledWith({
        cwd: '/Users/tester/project',
        shell: '/bin/zsh',
      });
      expect(ptyApi.resize).toHaveBeenCalledWith('pty-1', 132, 43);
    });
    expect(xtermMock.terminalInstances[0]?.focus).toHaveBeenCalled();
  });

  it('creates xterm with the currently loaded terminal settings', async () => {
    // Given: settings were loaded before the terminal pane mounts.
    setTerminalSettings({
      cursorBlink: false,
      cursorStyle: 'underline',
      macOptionIsMeta: false,
    });

    // When: the terminal pane mounts.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // Then: the xterm constructor receives the persisted settings.
    expect(xtermMock.terminalInstances[0]?.options).toMatchObject({
      cursorBlink: false,
      cursorStyle: 'underline',
      macOptionIsMeta: false,
    });
  });

  it('activates Unicode 11 width rules for xterm', async () => {
    // Given: xterm.js and the Unicode addon are mocked.

    // When: a terminal pane mounts.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // Then: xterm uses Unicode 11 cell-width rules for CJK and other wide characters.
    expect(xtermMock.terminalInstances[0]?.unicode.activeVersion).toBe('11');
  });

  it('applies terminal setting changes to the existing xterm instance without recreating the PTY', async () => {
    // Given: a terminal pane has already created its PTY.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: settings change while the pane is mounted.
    setTerminalSettings({
      cursorBlink: false,
      cursorStyle: 'underline',
      macOptionIsMeta: false,
    });

    // Then: live xterm options update and the running PTY is kept.
    await waitFor(() => {
      expect(xtermMock.terminalInstances[0]?.options).toMatchObject({
        cursorBlink: false,
        cursorStyle: 'underline',
        macOptionIsMeta: false,
      });
    });
    expect(ptyApi.create).toHaveBeenCalledOnce();
    expect(ptyApi.dispose).not.toHaveBeenCalled();
  });

  it('applies font setting changes and re-fits the terminal', async () => {
    // Given: a terminal pane is mounted.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });
    const initialFitCount = xtermMock.fitAddonInstances[0]?.fit.mock.calls.length ?? 0;

    // When: font settings change.
    setTerminalSettings({
      fontSize: 16,
      fontFamily: 'Fira Code',
      fontWeight: '300',
      fontWeightBold: '600',
    });

    // Then: xterm options are updated and fit is called to handle new cell dimensions.
    await waitFor(() => {
      expect(xtermMock.terminalInstances[0]?.options).toMatchObject({
        fontSize: 16,
        fontFamily: 'Fira Code',
        fontWeight: '300',
        fontWeightBold: '600',
      });
      expect(xtermMock.fitAddonInstances[0]?.fit.mock.calls.length).toBeGreaterThan(
        initialFitCount,
      );
    });
  });

  it('copies terminal selection to the clipboard only while copy-on-select is enabled', async () => {
    // Given: copy-on-select starts enabled.
    setTerminalSettings({ copyOnSelect: true });
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: the terminal selection changes.
    xtermMock.terminalInstances[0]?.emitSelectionChange('selected text');

    // Then: the selected text is copied to the clipboard.
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('selected text');
    });

    // When: copy-on-select is disabled and selection changes again.
    setTerminalSettings({ copyOnSelect: false });
    await waitFor(() => {
      expect(
        xtermMock.terminalInstances[0]?.selectionChangeDisposable.dispose,
      ).toHaveBeenCalledOnce();
    });
    xtermMock.terminalInstances[0]?.emitSelectionChange('ignored text');

    // Then: the disabled setting stops further clipboard writes.
    expect(clipboardWriteText).toHaveBeenCalledOnce();
  });

  it('reports PTY id lifecycle changes', async () => {
    // Given: a terminal pane receives a PTY id callback.
    const onPtyIdChange = vi.fn<(ptyId: string | null) => void>();
    const { unmount } = render(<TestTerminal onPtyIdChange={onPtyIdChange} />);

    // When: the PTY is created and then the pane unmounts.
    await waitFor(() => {
      expect(onPtyIdChange).toHaveBeenCalledWith('pty-1');
    });
    unmount();

    // Then: the owning pane can clear its runtime id.
    expect(onPtyIdChange).toHaveBeenCalledWith(null);
  });

  it('writes the initial command once after PTY creation', async () => {
    // Given: a terminal pane was created for an SSH host tab.
    const { rerender } = render(<TestTerminal initialCommand="ssh 'dev'" />);

    // When: the PTY is created and the component rerenders with the same command.
    await waitFor(() => {
      expect(ptyApi.write).toHaveBeenCalledWith('pty-1', "ssh 'dev'\r");
    });
    rerender(<TestTerminal initialCommand="ssh 'dev'" />);

    // Then: the command is injected once for that PTY.
    expect(ptyApi.write).toHaveBeenCalledTimes(1);
    expect(paneInfoApi.notifyCommand).toHaveBeenCalledWith('pty-1', "ssh 'dev'");
  });

  it('reports the submitted terminal command before writing Enter to the PTY', async () => {
    // Given: a terminal pane has an active PTY.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: the user types a command and presses Enter.
    xtermMock.terminalInstances[0]?.emitInput('pnpm run dev');
    xtermMock.terminalInstances[0]?.emitInput('\r');

    // Then: the command text the user submitted is sent to pane info.
    expect(paneInfoApi.notifyCommand).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
    expect(ptyApi.write).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
    expect(ptyApi.write).toHaveBeenCalledWith('pty-1', '\r');
  });

  it('handles simple command editing before reporting submitted input', async () => {
    // Given: a terminal pane has an active PTY.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: the user corrects input with backspace and submits it.
    xtermMock.terminalInstances[0]?.emitInput('pnpm run deX');
    xtermMock.terminalInstances[0]?.emitInput('\x7f');
    xtermMock.terminalInstances[0]?.emitInput('v');
    xtermMock.terminalInstances[0]?.emitInput('\r');

    // Then: the edited command is reported.
    expect(paneInfoApi.notifyCommand).toHaveBeenCalledWith('pty-1', 'pnpm run dev');
  });

  it('does not write the initial command if PTY creation resolves after unmount', async () => {
    // Given: PTY creation is still pending when the pane is closed.
    let resolveCreate!: (id: string) => void;
    ptyApi.create = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    // When: the terminal unmounts before IPC returns the PTY id.
    const { unmount } = render(<TestTerminal initialCommand="ssh 'dev'" />);
    unmount();
    resolveCreate?.('late-pty');
    await waitFor(() => {
      expect(ptyApi.dispose).toHaveBeenCalledWith('late-pty');
    });

    // Then: no command is sent to the disposed process.
    expect(ptyApi.write).not.toHaveBeenCalled();
  });

  it('does not focus an inactive terminal on mount or PTY creation', async () => {
    // Given: the pane belongs to an inactive tab or pane.

    // When: the terminal mounts and creates its PTY.
    render(<TestTerminal isActive={false} />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // Then: the inactive xterm instance is left mounted but unfocused.
    expect(xtermMock.terminalInstances[0]?.focus).not.toHaveBeenCalled();
  });

  it('focuses the terminal when it becomes active after mount', async () => {
    // Given: a terminal starts inactive but mounted.
    const { rerender } = render(<TestTerminal isActive={false} />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: the pane becomes active after a tab or pane selection change.
    rerender(<TestTerminal isActive />);

    // Then: the existing xterm instance receives focus without recreating the PTY.
    expect(xtermMock.terminalInstances[0]?.focus).toHaveBeenCalledOnce();
    expect(ptyApi.create).toHaveBeenCalledOnce();
  });

  it('swallows Cmd+Escape before xterm writes ESC to the PTY', async () => {
    // Given: a terminal pane has registered its custom key handler.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(xtermMock.terminalInstances[0]?.attachCustomKeyEventHandler).toHaveBeenCalledOnce();
    });

    // When / Then: Cmd+Escape is reserved for pane fullscreen, while plain Escape still flows.
    expect(
      xtermMock.terminalInstances[0]?.evaluateCustomKey(
        new KeyboardEvent('keydown', { key: 'Escape', metaKey: true }),
      ),
    ).toBe(false);
    expect(
      xtermMock.terminalInstances[0]?.evaluateCustomKey(
        new KeyboardEvent('keydown', { key: 'Escape', metaKey: false }),
      ),
    ).toBe(true);
    expect(
      xtermMock.terminalInstances[0]?.evaluateCustomKey(
        new KeyboardEvent('keyup', { key: 'Escape', metaKey: true }),
      ),
    ).toBe(true);
  });

  it('cleans up the PTY and listeners when the terminal unmounts', async () => {
    // Given: a mounted terminal with an active PTY id.
    const { unmount } = render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: React unmounts the terminal pane.
    unmount();

    // Then: the backing process, xterm input, and preload listeners are all disposed.
    expect(ptyApi.dispose).toHaveBeenCalledWith('pty-1');
    expect(xtermMock.terminalInstances[0]?.inputDisposable.dispose).toHaveBeenCalledOnce();
    expect(dataCleanup).toHaveBeenCalledOnce();
    expect(exitCleanup).toHaveBeenCalledOnce();
    expect(xtermMock.terminalInstances[0]?.dispose).toHaveBeenCalledOnce();
  });

  it('clears the PTY id when the process exits', async () => {
    // Given: a mounted terminal with an active PTY id.
    const onPtyIdChange = vi.fn<(ptyId: string | null) => void>();
    render(<TestTerminal onPtyIdChange={onPtyIdChange} />);
    await waitFor(() => {
      expect(onPtyIdChange).toHaveBeenCalledWith('pty-1');
    });

    // When: main reports process exit.
    exitListener?.('pty-1', 0);

    // Then: the pane runtime id is cleared.
    expect(onPtyIdChange).toHaveBeenCalledWith(null);
  });

  it('writes PTY output to xterm only for the active PTY id', async () => {
    // Given: a mounted terminal with a registered PTY data listener.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(dataListener).not.toBeNull();
    });

    // When: main emits data for another PTY and then for this pane.
    dataListener?.('other-pty', 'ignored');
    dataListener?.('pty-1', 'visible');

    // Then: only data matching the current runtime id is written to xterm.
    expect(xtermMock.terminalInstances[0]?.write).toHaveBeenCalledTimes(1);
    expect(xtermMock.terminalInstances[0]?.write).toHaveBeenCalledWith('visible');
  });

  it('resizes the PTY when the observed terminal container changes size', async () => {
    // Given: a mounted terminal with a current PTY id.
    // 132 cols and 43 rows match MockTerminal.cols/rows — the PTY receives the xterm size as-is.
    render(<TestTerminal />);
    await waitFor(() => {
      expect(ptyApi.resize).toHaveBeenCalledWith('pty-1', 132, 43);
    });
    ptyApi.resize.mockClear();

    // When: the terminal container resize observer fires.
    resizeObserverCallback?.();

    // Then: the latest xterm dimensions are sent to the main PTY.
    expect(ptyApi.resize).toHaveBeenCalledWith('pty-1', 132, 43);
  });

  it('does not recreate the PTY when cwd props change after mount', async () => {
    // Given: a mounted terminal whose process was created from the initial cwd.
    const { rerender } = render(<TestTerminal cwd="/Users/tester/project" />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalledWith({
        cwd: '/Users/tester/project',
        shell: '/bin/zsh',
      });
    });

    // When: the pane cwd prop changes after a future OSC 7 update.
    rerender(<TestTerminal cwd="/Users/tester/other" />);

    // Then: the running shell is kept alive instead of being replaced by a new PTY.
    expect(ptyApi.create).toHaveBeenCalledOnce();
    expect(ptyApi.dispose).not.toHaveBeenCalled();
  });

  it('re-fits the terminal after fonts are ready', async () => {
    // Given: a terminal is mounting while fonts are loading.
    render(<TestTerminal />);

    // 1. Initial fit on mount.
    // 2. fitAndResize on PTY creation success.
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
      expect(xtermMock.fitAddonInstances[0]?.fit).toHaveBeenCalledTimes(2);
    });

    // When: fonts become ready.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.fonts as any)._resolve();

    // Then: fit is called a 3rd time.
    await waitFor(() => {
      expect(xtermMock.fitAddonInstances[0]?.fit).toHaveBeenCalledTimes(3);
    });
  });

  it('does not re-fit if the component unmounts before fonts are ready', async () => {
    // Given: a terminal mounts and then quickly unmounts.
    const { unmount } = render(<TestTerminal />);

    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });
    const fitSpy = xtermMock.fitAddonInstances[0]?.fit;
    expect(fitSpy).toHaveBeenCalledTimes(2);
    unmount();

    // When: fonts finally become ready.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document.fonts as any)._resolve();

    // Then: no further fit calls are made (stale closure guard).
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fitSpy).toHaveBeenCalledTimes(2);
  });
});
