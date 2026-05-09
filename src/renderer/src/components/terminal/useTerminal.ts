import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { parseOsc7Cwd } from './osc7';
import { terminalTheme } from './theme';

const PTY_COLUMNS_SAFETY_MARGIN = 3;
const BACKSPACE = '\x7f';
const CTRL_C = '\x03';
const CTRL_U = '\x15';
const ENTER = '\r';

interface UseTerminalOptions {
  cwd: string;
  initialCommand?: string;
  isActive?: boolean;
  onCwdChange?: (cwd: string) => void;
  onPtyIdChange?: (ptyId: string | null) => void;
  shell?: string;
}

interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Connects an xterm.js instance to the main-process PTY API for one terminal pane.
 *
 * This hook intentionally owns both xterm and PTY subscriptions together. Phase 1 has no pane store
 * yet, so the runtime PTY id lives here and will later become the implementation detail behind a
 * persisted pane model.
 */
export function useTerminal(options: UseTerminalOptions): UseTerminalResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const initialOptionsRef = useRef(options);
  const initialCommandWrittenPtyIdsRef = useRef(new Set<string>());
  const pendingCommandRef = useRef('');
  const isActiveRef = useRef(options.isActive ?? false);
  const onCwdChangeRef = useRef(options.onCwdChange);
  const onPtyIdChangeRef = useRef(options.onPtyIdChange);

  useEffect(() => {
    isActiveRef.current = options.isActive ?? false;
  }, [options.isActive]);

  useEffect(() => {
    onCwdChangeRef.current = options.onCwdChange;
  }, [options.onCwdChange]);

  useEffect(() => {
    onPtyIdChangeRef.current = options.onPtyIdChange;
  }, [options.onPtyIdChange]);

  const focusIfActive = useCallback((): void => {
    if (isActiveRef.current) {
      terminalRef.current?.focus();
    }
  }, []);

  const fitAndResize = useCallback((): void => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const ptyId = ptyIdRef.current;
    if (!terminal || !fitAddon) {
      return;
    }

    fitAddon.fit();

    if (ptyId) {
      // Use xterm's committed size after `fit()`. Calling `proposeDimensions()` again can observe
      // post-fit rounded cell metrics and produce a value that differs from the actual viewport.
      // The PTY is kept slightly narrower than xterm so TUI apps wrap before DOM renderer
      // overhang or CJK string-width differences can clip the rightmost cells.
      const ptyCols = Math.max(1, terminal.cols - PTY_COLUMNS_SAFETY_MARGIN);
      void window.api.pty.resize(ptyId, ptyCols, terminal.rows);
    }
  }, []);

  useResizeObserver(containerRef, fitAndResize);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();

    // xterm writes ESC to the PTY for both `Escape` and `Cmd+Escape` because its keyboard
    // evaluation ignores Cmd for special keys. Swallowing this chord here keeps pane fullscreen's
    // window-level shortcut from also changing terminal app state, such as switching vim modes.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Escape' && event.metaKey) {
        return false;
      }

      return true;
    });
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    fitAndResize();

    // Re-fit once fonts are ready to ensure accurate cell width measurements
    if (typeof document !== 'undefined' && 'fonts' in document) {
      void document.fonts.ready.then(() => {
        if (terminalRef.current === terminal && fitAddonRef.current === fitAddon) {
          fitAndResize();
        }
      });
    }

    focusIfActive();
    const osc7Disposable = terminal.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7Cwd(data);
      if (cwd) {
        onCwdChangeRef.current?.(cwd);
        const ptyId = ptyIdRef.current;
        if (ptyId) {
          void window.api?.paneInfo?.notifyCwd(ptyId, cwd);
        }
      }

      return true;
    });

    const ptyApi = window.api?.pty;
    if (!ptyApi) {
      // Vitest/jsdom renders this component without Electron's preload. Showing a terminal-local
      // message keeps smoke tests simple while making a broken preload obvious in development.
      terminal.writeln('Terminal API is unavailable.');
      return () => {
        osc7Disposable.dispose();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }

    let disposed = false;
    const dataCleanup = ptyApi.onData((id, data) => {
      if (id === ptyIdRef.current) {
        terminal.write(data);
      }
    });
    const exitCleanup = ptyApi.onExit((id, code) => {
      if (id === ptyIdRef.current) {
        terminal.writeln('');
        terminal.writeln(`[process exited with code ${code}]`);
        ptyIdRef.current = null;
        onPtyIdChangeRef.current?.(null);
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const ptyId = ptyIdRef.current;
      if (ptyId) {
        // Capture the plain command line submitted by the terminal UI for sidebar display. This is
        // intentionally lightweight and only tracks ASCII printable input appended at the cursor,
        // Enter, Backspace, Ctrl-C, and Ctrl-U. Unicode input such as Japanese text and edits made
        // after cursor movement can drift from the real shell buffer. That limitation is accepted
        // until a future shell integration layer, such as OSC 133, can report the submitted command
        // with shell-level accuracy.
        const submittedCommand = updatePendingCommand(pendingCommandRef, data);
        if (submittedCommand) {
          void window.api?.paneInfo?.notifyCommand(ptyId, submittedCommand);
        }
        void ptyApi.write(ptyId, data);
      }
    });

    // cwd is a process creation input, not live terminal state. Later OSC 7 updates will change the
    // persisted pane cwd, but they must not restart the running shell just because props changed.
    const initialOptions = initialOptionsRef.current;
    void ptyApi.create({ cwd: initialOptions.cwd, shell: initialOptions.shell }).then((id) => {
      if (disposed) {
        // PTY creation crosses the IPC boundary and can complete after React has unmounted this
        // pane. Disposing the late process prevents orphan shells when users close panes quickly.
        void ptyApi.dispose(id);
        return;
      }

      ptyIdRef.current = id;
      onPtyIdChangeRef.current?.(id);
      void window.api?.paneInfo?.notifyCwd(id, initialOptions.cwd);
      fitAndResize();
      focusIfActive();

      const initialCommand = initialOptions.initialCommand;
      if (initialCommand && !initialCommandWrittenPtyIdsRef.current.has(id)) {
        initialCommandWrittenPtyIdsRef.current.add(id);
        void window.api?.paneInfo?.notifyCommand(id, initialCommand);
        // Fire-and-forget: IPC failures here surface through subsequent terminal silence;
        // retrying would risk replaying the command twice if the PTY is still alive.
        void ptyApi.write(id, `${initialCommand}\r`);
      }
    });

    return () => {
      disposed = true;
      const ptyId = ptyIdRef.current;
      ptyIdRef.current = null;
      if (ptyId) {
        onPtyIdChangeRef.current?.(null);
        void ptyApi.dispose(ptyId);
      }
      inputDisposable.dispose();
      osc7Disposable.dispose();
      dataCleanup();
      exitCleanup();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitAndResize, focusIfActive]);

  useEffect(() => {
    focusIfActive();
  }, [focusIfActive, options.isActive]);

  return { containerRef };
}

function updatePendingCommand(
  pendingCommandRef: MutableRefObject<string>,
  data: string,
): string | null {
  if (data === ENTER) {
    const submittedCommand = pendingCommandRef.current.trim();
    pendingCommandRef.current = '';
    return submittedCommand || null;
  }

  if (data === BACKSPACE) {
    pendingCommandRef.current = pendingCommandRef.current.slice(0, -1);
    return null;
  }

  if (data === CTRL_C || data === CTRL_U) {
    pendingCommandRef.current = '';
    return null;
  }

  if (isPrintableInput(data)) {
    pendingCommandRef.current += data;
  }

  return null;
}

function isPrintableInput(data: string): boolean {
  return /^[\x20-\x7e]+$/.test(data);
}
