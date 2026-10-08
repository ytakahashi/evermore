import type { IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import { getTerminalCommandBlockRange } from './command-block-range';
import { createTerminalCommandBlockRows } from './command-block-rows';

/** Draws status along every physical row, including rows whose block start is offscreen. */
export function createTerminalCommandBlockGauge(
  terminal: Terminal,
  entry: TerminalCommandHistoryEntry,
): IDisposable {
  return createTerminalCommandBlockRows(terminal, entry, {
    options: () => ({ width: 1, anchor: 'left', height: 1, layer: 'bottom' }),
    rebuildOnBufferChange: true,
    onRender: (element, marker) => {
      element.classList.add('evermore-command-block-gauge');
      element.dataset.status =
        entry.exitCode === null ? 'unknown' : entry.exitCode === 0 ? 'success' : 'error';
      // Mark physical boundaries, not viewport edges: scrolling through a block must not create a new cap.
      const range = getTerminalCommandBlockRange(entry, terminal.buffer.normal.length);
      element.dataset.start = String(marker.line === range?.start);
      element.dataset.end = String(marker.line === range?.end);
      element.setAttribute('aria-hidden', 'true');
    },
  });
}
