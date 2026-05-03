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
    public readonly inputDisposable = { dispose: vi.fn() };
    private inputListener: ((data: string) => void) | null = null;

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
}

function TestTerminal({ cwd = '/Users/tester/project' }: TestTerminalProps): React.JSX.Element {
  const { containerRef } = useTerminal({ cwd, shell: '/bin/zsh' });

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
});
