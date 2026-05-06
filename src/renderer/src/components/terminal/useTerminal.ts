import { useCallback, useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { parseOsc7Cwd } from './osc7';
import { terminalTheme } from './theme';

const PTY_COLUMNS_SAFETY_MARGIN = 3;

interface UseTerminalOptions {
  cwd: string;
  initialCommand?: string;
  isActive?: boolean;
  onCwdChange?: (cwd: string) => void;
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
  const isActiveRef = useRef(options.isActive ?? false);
  const onCwdChangeRef = useRef(options.onCwdChange);

  useEffect(() => {
    isActiveRef.current = options.isActive ?? false;
  }, [options.isActive]);

  useEffect(() => {
    onCwdChangeRef.current = options.onCwdChange;
  }, [options.onCwdChange]);

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
      }
    });
    const inputDisposable = terminal.onData((data) => {
      const ptyId = ptyIdRef.current;
      if (ptyId) {
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
      fitAndResize();
      focusIfActive();

      const initialCommand = initialOptions.initialCommand;
      if (initialCommand && !initialCommandWrittenPtyIdsRef.current.has(id)) {
        initialCommandWrittenPtyIdsRef.current.add(id);
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
