import type { IDecorationOptions, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import { getTerminalCommandBlockRange } from './command-block-range';

interface CommandBlockRowPresentation {
  options: () => Omit<IDecorationOptions, 'marker'>;
  onRender: (element: HTMLElement, marker: IMarker) => void;
  rebuildOnBufferChange?: boolean;
}

/** Owns row decorations and their markers, borrowing the history boundaries without disposing them. */
export function createTerminalCommandBlockRows(
  terminal: Terminal,
  entry: TerminalCommandHistoryEntry,
  presentation: CommandBlockRowPresentation,
): IDisposable {
  const rows: IDisposable[] = [];
  let disposed = false;
  const clearRows = (): void => {
    for (const row of rows.splice(0)) {
      row.dispose();
    }
  };
  const render = (): void => {
    clearRows();
    const buffer = terminal.buffer.normal;
    if (disposed || terminal.buffer.active.type !== 'normal') {
      return;
    }
    const range = getTerminalCommandBlockRange(entry, buffer.length);
    if (!range) {
      return;
    }
    const { start, end } = range;
    const cursorLine = buffer.baseY + buffer.cursorY;
    for (let line = start; line <= end; line += 1) {
      const marker: IMarker | undefined = terminal.registerMarker(line - cursorLine);
      if (!marker) {
        clearRows();
        return;
      }
      const decoration = terminal.registerDecoration({
        marker,
        ...presentation.options(),
      });
      if (!decoration) {
        marker.dispose();
        clearRows();
        return;
      }
      // A tall decoration disappears when its anchor is offscreen; independent rows keep the gutter visible.
      const rendered = decoration.onRender((element) => {
        presentation.onRender(element, marker);
      });
      rows.push({
        dispose: () => {
          rendered.dispose();
          if (!decoration.isDisposed) {
            decoration.dispose();
          }
          if (!marker.isDisposed) {
            marker.dispose();
          }
        },
      });
    }
  };
  render();
  const resized = terminal.onResize(render);
  // Selection is cleared by its owner on alternate-screen entry; persistent gauges must rebuild on return.
  const bufferChanged = presentation.rebuildOnBufferChange
    ? terminal.buffer.onBufferChange(render)
    : undefined;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      resized.dispose();
      bufferChanged?.dispose();
      clearRows();
    },
  };
}
