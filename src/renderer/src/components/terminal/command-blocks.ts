import type { IDisposable, Terminal } from '@xterm/xterm';
import { createTerminalCommandCopyDecoration } from './command-copy-decoration';
import { TerminalCommandHistory, type TerminalCommandHistoryEntry } from './command-history';

/** Attaches completed-command copy decorations to a terminal and owns their lifecycle. */
export function attachCommandBlocks(terminal: Terminal): IDisposable {
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

  return {
    dispose: () => {
      for (const decoration of commandDecorations.values()) {
        decoration.dispose();
      }
      commandDecorations.clear();
      commandHistory.dispose();
    },
  };
}
