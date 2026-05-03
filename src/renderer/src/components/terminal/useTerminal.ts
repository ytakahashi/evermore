import { useCallback, useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { parseOsc7Cwd } from './osc7';
import { terminalTheme } from './theme';

interface UseTerminalOptions {
  cwd: string;
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
  const onCwdChangeRef = useRef(options.onCwdChange);

  useEffect(() => {
    onCwdChangeRef.current = options.onCwdChange;
  }, [options.onCwdChange]);

  const fitAndResize = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const ptyId = ptyIdRef.current;
    if (!fitAddon) {
      return;
    }

    fitAddon.fit();

    if (ptyId) {
      // `fit()` mutates xterm's viewport, while `proposeDimensions()` gives us the character grid
      // main needs for the actual PTY. Keeping them paired avoids visual and backend sizes drifting.
      const dimensions = fitAddon.proposeDimensions();
      void window.api.pty.resize(ptyId, dimensions?.cols ?? 80, dimensions?.rows ?? 24);
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
  }, [fitAndResize]);

  return { containerRef };
}
