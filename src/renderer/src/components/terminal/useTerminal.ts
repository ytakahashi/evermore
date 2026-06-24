import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings-defaults';
import { useSettingsStore } from '../../stores/settingsStore';
import { createTerminalCommandCopyDecoration } from './command-copy-decoration';
import { TerminalCommandHistory, type TerminalCommandHistoryEntry } from './command-history';
import { terminalTheme } from './theme';

const BACKSPACE = '\x7f';
const CTRL_C = '\x03';
const CTRL_U = '\x15';
const ENTER = '\r';

export type PtyIdChangeReason = 'created' | 'exit' | 'unmount';

interface UseTerminalOptions {
  cwd: string;
  initialCommand?: string;
  isActive?: boolean;
  onPtyIdChange?: (ptyId: string | null, reason: PtyIdChangeReason) => void;
  paneId?: string;
}

interface UseTerminalResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Connects an xterm.js instance to the main-process PTY API for one terminal pane.
 *
 * The hook owns the renderer-only terminal lifecycle: xterm/addon setup, fit/resize updates,
 * settings application, PTY creation/disposal, PTY data forwarding, focus handling, and optional
 * initial command injection. Pane runtime state itself is owned by the main process. The hook
 * reports the PTY id to the caller and forwards user-submitted command text as a fallback for
 * sidebar display until shell integration sequences cover every pane.
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
  const onPtyIdChangeRef = useRef(options.onPtyIdChange);
  const cursorStyle = useSettingsStore(
    (state) => state.settings?.terminal.cursorStyle ?? DEFAULT_APP_SETTINGS.terminal.cursorStyle,
  );
  const cursorBlink = useSettingsStore(
    (state) => state.settings?.terminal.cursorBlink ?? DEFAULT_APP_SETTINGS.terminal.cursorBlink,
  );
  const macOptionIsMeta = useSettingsStore(
    (state) =>
      state.settings?.terminal.macOptionIsMeta ?? DEFAULT_APP_SETTINGS.terminal.macOptionIsMeta,
  );
  const copyOnSelect = useSettingsStore(
    (state) => state.settings?.terminal.copyOnSelect ?? DEFAULT_APP_SETTINGS.terminal.copyOnSelect,
  );
  const fontSize = useSettingsStore(
    (state) => state.settings?.terminal.fontSize ?? DEFAULT_APP_SETTINGS.terminal.fontSize,
  );
  const fontFamily = useSettingsStore(
    (state) => state.settings?.terminal.fontFamily ?? DEFAULT_APP_SETTINGS.terminal.fontFamily,
  );
  const fontWeight = useSettingsStore(
    (state) => state.settings?.terminal.fontWeight ?? DEFAULT_APP_SETTINGS.terminal.fontWeight,
  );
  const fontWeightBold = useSettingsStore(
    (state) =>
      state.settings?.terminal.fontWeightBold ?? DEFAULT_APP_SETTINGS.terminal.fontWeightBold,
  );
  const terminalSettingsRef = useRef({
    cursorStyle,
    cursorBlink,
    macOptionIsMeta,
    fontSize,
    fontFamily,
    fontWeight,
    fontWeightBold,
  });

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
      // CJK character width is handled by Unicode11Addon, so the PTY and xterm use the same column
      // count. Mismatching them would cause shell line-wrap and cursor position calculations to
      // diverge from xterm's display, breaking long commands and tab completion.
      void window.api.pty.resize(ptyId, terminal.cols, terminal.rows);
    }
  }, []);

  useEffect(() => {
    terminalSettingsRef.current = {
      cursorStyle,
      cursorBlink,
      macOptionIsMeta,
      fontSize,
      fontFamily,
      fontWeight,
      fontWeightBold,
    };

    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.cursorStyle = cursorStyle;
    terminal.options.cursorBlink = cursorBlink;
    terminal.options.macOptionIsMeta = macOptionIsMeta;
    terminal.options.fontSize = fontSize;
    terminal.options.fontFamily = fontFamily;
    terminal.options.fontWeight = fontWeight;
    terminal.options.fontWeightBold = fontWeightBold;

    // Font changes affect cell dimensions, so we must re-fit
    fitAndResize();
  }, [
    cursorStyle,
    cursorBlink,
    macOptionIsMeta,
    fontSize,
    fontFamily,
    fontWeight,
    fontWeightBold,
    fitAndResize,
  ]);

  useEffect(() => {
    isActiveRef.current = options.isActive ?? false;
  }, [options.isActive]);

  useEffect(() => {
    onPtyIdChangeRef.current = options.onPtyIdChange;
  }, [options.onPtyIdChange]);

  useResizeObserver(containerRef, fitAndResize);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const initialTerminalSettings = terminalSettingsRef.current;
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: initialTerminalSettings.cursorBlink,
      cursorStyle: initialTerminalSettings.cursorStyle,
      fontFamily: initialTerminalSettings.fontFamily,
      fontSize: initialTerminalSettings.fontSize,
      fontWeight: initialTerminalSettings.fontWeight,
      fontWeightBold: initialTerminalSettings.fontWeightBold,
      macOptionIsMeta: initialTerminalSettings.macOptionIsMeta,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(container);
    // Activate Unicode 11 so CJK and other wide characters are measured as 2 columns. This must be
    // set after `open()` because the terminal's unicode service is initialised during that call.
    terminal.unicode.activeVersion = '11';
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
    const ptyApi = window.api?.pty;
    if (!ptyApi) {
      // Vitest/jsdom renders this component without Electron's preload. Showing a terminal-local
      // message keeps smoke tests simple while making a broken preload obvious in development.
      terminal.writeln('Terminal API is unavailable.');
      return () => {
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }

    let disposed = false;
    const commandDecorations = new Map<string, IDisposable>();
    const commandHistory = new TerminalCommandHistory({
      terminal,
      onCommandCompleted: (entry: TerminalCommandHistoryEntry) => {
        // Entry ids are unique, so this only guards against an unexpected duplicate completion for
        // the same id leaking a previous decoration.
        commandDecorations.get(entry.id)?.dispose();
        let decoration: IDisposable | null = null;
        decoration = createTerminalCommandCopyDecoration({
          terminal,
          entry,
          onDisposed: () => {
            if (commandDecorations.get(entry.id) === decoration) {
              commandDecorations.delete(entry.id);
            }
          },
        });
        if (decoration) {
          commandDecorations.set(entry.id, decoration);
        }
      },
      onCommandRemoved: (entry: TerminalCommandHistoryEntry) => {
        commandDecorations.get(entry.id)?.dispose();
        commandDecorations.delete(entry.id);
      },
    });
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
        onPtyIdChangeRef.current?.(null, 'exit');
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

    // cwd is a process creation input, not live terminal state. Live cwd updates flow through the
    // main-process pane runtime feed and reach the workspace store via `usePaneInfoBridge`; this
    // hook intentionally never restarts the running shell because of prop drift.
    const initialOptions = initialOptionsRef.current;
    void ptyApi
      .create({
        cwd: initialOptions.cwd,
        paneId: initialOptions.paneId,
      })
      .then((id) => {
        if (disposed) {
          // PTY creation crosses the IPC boundary and can complete after React has unmounted this
          // pane. Disposing the late process prevents orphan shells when users close panes quickly.
          void ptyApi.dispose(id);
          return;
        }

        ptyIdRef.current = id;
        onPtyIdChangeRef.current?.(id, 'created');
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
        onPtyIdChangeRef.current?.(null, 'unmount');
        void ptyApi.dispose(ptyId);
      }
      inputDisposable.dispose();
      dataCleanup();
      exitCleanup();
      for (const decoration of commandDecorations.values()) {
        decoration.dispose();
      }
      commandDecorations.clear();
      commandHistory.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitAndResize, focusIfActive]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !copyOnSelect) {
      return;
    }

    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (!selection || typeof navigator === 'undefined' || !navigator.clipboard) {
        return;
      }

      void navigator.clipboard.writeText(selection).catch((_error: unknown) => {
        // Clipboard writes can be rejected by browser permissions. Copy-on-select is best-effort,
        // and the normal explicit copy shortcuts still work, so there is nothing useful to recover.
      });
    });

    return () => {
      selectionDisposable.dispose();
    };
  }, [copyOnSelect]);

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
