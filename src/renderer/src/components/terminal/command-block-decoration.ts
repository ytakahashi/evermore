import type { IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import { createTerminalCommandBlockRows } from './command-block-rows';

/** Highlights one selected block without changing xterm's text selection or clipboard. */
export function createTerminalCommandBlockDecoration(
  terminal: Terminal,
  entry: TerminalCommandHistoryEntry,
): IDisposable {
  return createTerminalCommandBlockRows(terminal, entry, {
    options: () => ({ width: terminal.cols, height: 1, layer: 'bottom' }),
    onRender: (element) => {
      // A translucent DOM decoration also covers empty lines and trailing cells, unlike cell backgrounds.
      element.classList.add('evermore-command-block-selection');
    },
  });
}
