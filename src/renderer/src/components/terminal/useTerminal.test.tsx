import { render, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminal } from './useTerminal';

const xtermMock = vi.hoisted(() => {
  const terminalInstances: MockTerminal[] = [];
  const fitAddonInstances: MockFitAddon[] = [];

  class MockTerminal {
    public readonly loadAddon = vi.fn();
    public readonly open = vi.fn();
    public readonly write = vi.fn();
    public readonly writeln = vi.fn();
    public readonly dispose = vi.fn();
    public readonly focus = vi.fn();
    public readonly inputDisposable = { dispose: vi.fn() };
    public readonly osc7Disposable = { dispose: vi.fn() };
    public readonly parser = {
      registerOscHandler: vi.fn((ident: number, listener: (data: string) => boolean) => {
        if (ident === 7) {
          this.osc7Listener = listener;
        }

        return this.osc7Disposable;
      }),
    };
    private inputListener: ((data: string) => void) | null = null;
    private osc7Listener: ((data: string) => boolean) | null = null;

    public constructor() {
      terminalInstances.push(this);
    }

    public onData(listener: (data: string) => void): { dispose: () => void } {
      this.inputListener = listener;
      return this.inputDisposable;
    }

    public emitInput(data: string): void {
      this.inputListener?.(data);
    }

    public emitOsc7(data: string): boolean | null {
      return this.osc7Listener?.(data) ?? null;
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
  onCwdChange?: (cwd: string) => void;
}

function TestTerminal({
  cwd = '/Users/tester/project',
  initialCommand,
  isActive = true,
  onCwdChange,
}: TestTerminalProps): React.JSX.Element {
  const { containerRef } = useTerminal({
    cwd,
    initialCommand,
    isActive,
    onCwdChange,
    shell: '/bin/zsh',
  });

  return <div ref={containerRef} />;
}

describe('useTerminal', () => {
  let ptyApi: PtyApiMock;
  let dataCleanup: Mock<() => void>;
  let exitCleanup: Mock<() => void>;
  let dataListener: ((id: string, data: string) => void) | null;
  let resizeObserverCallback: (() => void) | null;

  beforeEach(() => {
    dataCleanup = vi.fn<() => void>();
    exitCleanup = vi.fn<() => void>();
    dataListener = null;
    resizeObserverCallback = null;
    xtermMock.terminalInstances.length = 0;
    xtermMock.fitAddonInstances.length = 0;

    ptyApi = {
      create: vi.fn(() => Promise.resolve('pty-1')),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      dispose: vi.fn(() => Promise.resolve()),
      onData: vi.fn((cb) => {
        dataListener = cb;
        return dataCleanup;
      }),
      onExit: vi.fn(() => exitCleanup),
    };

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: ptyApi },
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
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'api');
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('creates a PTY when the terminal mounts and resizes it after creation', async () => {
    // Given: xterm.js and the preload PTY API are mocked.

    // When: a terminal pane mounts.
    render(<TestTerminal />);

    // Then: the hook creates a PTY for the pane and syncs xterm dimensions to main.
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalledWith({
        cwd: '/Users/tester/project',
        shell: '/bin/zsh',
      });
      expect(ptyApi.resize).toHaveBeenCalledWith('pty-1', 132, 43);
    });
    expect(xtermMock.terminalInstances[0]?.focus).toHaveBeenCalled();
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
    expect(xtermMock.terminalInstances[0]?.osc7Disposable.dispose).toHaveBeenCalledOnce();
    expect(dataCleanup).toHaveBeenCalledOnce();
    expect(exitCleanup).toHaveBeenCalledOnce();
    expect(xtermMock.terminalInstances[0]?.dispose).toHaveBeenCalledOnce();
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

  it('reports OSC 7 cwd changes without recreating the PTY', async () => {
    // Given: a mounted terminal with an OSC 7 handler.
    const onCwdChange = vi.fn<(cwd: string) => void>();
    render(<TestTerminal onCwdChange={onCwdChange} />);
    await waitFor(() => {
      expect(ptyApi.create).toHaveBeenCalled();
    });

    // When: xterm parses valid and invalid OSC 7 payloads.
    const handled = xtermMock.terminalInstances[0]?.emitOsc7(
      'file://hostname/Users/tester/My%20Project',
    );
    xtermMock.terminalInstances[0]?.emitOsc7('https://example.com/ignored');

    // Then: only the valid file URL updates cwd state and no process is recreated.
    expect(handled).toBe(true);
    expect(onCwdChange).toHaveBeenCalledOnce();
    expect(onCwdChange).toHaveBeenCalledWith('/Users/tester/My Project');
    expect(ptyApi.create).toHaveBeenCalledOnce();
  });
});
