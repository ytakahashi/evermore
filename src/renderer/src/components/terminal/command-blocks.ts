import type { IDisposable, Terminal } from '@xterm/xterm';
import {
  createTerminalCommandCopyDecoration,
  type TerminalCommandCopyDecoration,
} from './command-copy-decoration';
import { TerminalCommandHistory, type TerminalCommandHistoryEntry } from './command-history';
import { createTerminalCommandBlockDecoration } from './command-block-decoration';
import { TerminalCommandCopyController } from './command-copy';
import { findAdjacentCommand } from './command-navigation';
import { createTerminalCommandBlockGauge } from './command-block-gauge';
import { TerminalCommandToolbarHover } from './command-toolbar-hover';

/** Attaches command navigation and copy decorations to a terminal and owns their lifecycle. */
export function attachCommandBlocks(terminal: Terminal): IDisposable {
  const root = terminal.element;
  const addedGutter = root !== undefined && !root.classList.contains('evermore-command-blocks');
  root?.classList.add('evermore-command-blocks');
  const hover = new TerminalCommandToolbarHover(terminal);
  const gauges = new Map<string, IDisposable>();
  const commandDecorations = new Map<string, TerminalCommandCopyDecoration>();
  const copies = new Map<string, TerminalCommandCopyController>();
  let selectedId: string | null = null;
  let highlight: IDisposable | null = null;
  const clearSelection = (): void => {
    selectedId = null;
    highlight?.dispose();
    highlight = null;
  };
  let navigatedId: string | null = null;
  let disposed = false;
  const resetNavigation = (): void => {
    navigatedId = null;
  };
  const commandHistory = new TerminalCommandHistory({
    terminal,
    onCommandCompleted: (entry: TerminalCommandHistoryEntry) => {
      // Entry ids are unique, so this only guards against an unexpected duplicate completion for
      // the same id leaking a previous decoration.
      commandDecorations.get(entry.id)?.dispose();
      copies.get(entry.id)?.dispose();
      gauges.get(entry.id)?.dispose();
      gauges.set(entry.id, createTerminalCommandBlockGauge(terminal, entry));
      const copyController = new TerminalCommandCopyController({ terminal, entry });
      copies.set(entry.id, copyController);
      let decoration: TerminalCommandCopyDecoration | null = null;
      decoration = createTerminalCommandCopyDecoration({
        terminal,
        entry,
        copyController,
        hover,
        onFocusedEntryRemoved: () => {
          // A marker can disappear during teardown; the attachment owns terminal liveness.
          if (!disposed) {
            terminal.focus();
          }
        },
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
      if (entry.id === navigatedId) {
        resetNavigation();
      }
      if (entry.id === selectedId) {
        clearSelection();
      }
      // History observes markers first, so its removal notification must carry the disposal reason.
      commandDecorations.get(entry.id)?.disposeForRemoval();
      commandDecorations.delete(entry.id);
      gauges.get(entry.id)?.dispose();
      gauges.delete(entry.id);
      copies.get(entry.id)?.dispose();
      copies.delete(entry.id);
    },
  });

  const disposables = [
    terminal.onData(() => {
      clearSelection();
      resetNavigation();
    }),
    terminal.buffer.onBufferChange((buffer) => {
      if (buffer.type === 'alternate') {
        clearSelection();
        resetNavigation();
      }
    }),
  ];

  // This attachment owns xterm's single custom key handler; teardown replaces it with passthrough.
  // The disposed guard also protects callers retaining a reference to the previous handler.
  terminal.attachCustomKeyEventHandler((event) => {
    if (disposed || terminal.buffer.active.type !== 'normal' || event.type !== 'keydown') {
      return true;
    }
    // xterm invokes this handler before its composition helper; IME cancellation must reach it.
    if (event.isComposing || event.keyCode === 229) {
      return true;
    }
    if (
      event.key === 'Escape' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      selectedId !== null
    ) {
      event.preventDefault();
      clearSelection();
      return false;
    }
    if (
      event.code === 'KeyC' &&
      event.metaKey &&
      !event.ctrlKey &&
      event.altKey !== event.shiftKey
    ) {
      const copy = selectedId === null ? undefined : copies.get(selectedId);
      if (!copy) {
        return true;
      }
      event.preventDefault();
      void copy.copy(event.altKey ? 'output' : 'command-and-output');
      return false;
    }
    if (
      !event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    ) {
      return true;
    }
    const entries = commandHistory.getCompletedCommands();
    if (entries.length === 0) {
      return true;
    }
    event.preventDefault();
    const anchor = entries.find((entry) => entry.id === navigatedId);
    const buffer = terminal.buffer.active;
    const anchorStillShown =
      anchor !== undefined &&
      buffer.viewportY === Math.min(anchor.blockStartMarker.line, buffer.baseY);
    if (!anchorStillShown) {
      resetNavigation();
    }
    // At the bottom, the current prompt is the starting point so visible commands are not skipped.
    const anchorLine = anchorStillShown
      ? anchor.blockStartMarker.line
      : buffer.viewportY === buffer.baseY
        ? buffer.baseY + buffer.cursorY
        : buffer.viewportY;
    const direction = event.key === 'ArrowUp' ? 'previous' : 'next';
    const id = findAdjacentCommand(
      entries.map((entry) => ({ id: entry.id, startLine: entry.blockStartMarker.line })),
      anchorLine,
      direction,
    );
    const target = entries.find((entry) => entry.id === id);
    if (target) {
      // Near the bottom, scrolling clamps to baseY. Keep the command id, not the viewport, as anchor.
      navigatedId = target.id;
      if (selectedId !== target.id) {
        clearSelection();
        selectedId = target.id;
        highlight = createTerminalCommandBlockDecoration(terminal, target);
      }
      terminal.scrollToLine(target.blockStartMarker.line);
    } else if (direction === 'next') {
      clearSelection();
      resetNavigation();
      terminal.scrollToBottom();
    }
    return false;
  });

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      hover.dispose();
      clearSelection();
      resetNavigation();
      terminal.attachCustomKeyEventHandler(() => true);
      for (const disposable of disposables) {
        disposable.dispose();
      }
      for (const decoration of commandDecorations.values()) {
        decoration.dispose();
      }
      commandDecorations.clear();
      for (const gauge of gauges.values()) {
        gauge.dispose();
      }
      gauges.clear();
      for (const copy of copies.values()) {
        copy.dispose();
      }
      copies.clear();
      commandHistory.dispose();
      if (addedGutter) {
        root?.classList.remove('evermore-command-blocks');
      }
    },
  };
}
