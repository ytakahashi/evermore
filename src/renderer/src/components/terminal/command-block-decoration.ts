import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';

/** Highlights one selected block without changing xterm's text selection or clipboard. */
export function createTerminalCommandBlockDecoration(
  terminal: Terminal,
  entry: TerminalCommandHistoryEntry,
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
    if (
      disposed ||
      terminal.buffer.active.type !== 'normal' ||
      entry.blockStartMarker.isDisposed ||
      entry.outputEnd.marker.isDisposed
    ) {
      return;
    }
    const start = entry.blockStartMarker.line;
    if (
      start < 0 ||
      entry.outputEnd.marker.line < start ||
      entry.outputEnd.marker.line >= buffer.length
    ) {
      return;
    }
    // D is an exclusive boundary: column zero belongs to the next prompt, not this block.
    const end = Math.max(
      start,
      entry.outputEnd.marker.line - (entry.outputEnd.column === 0 ? 1 : 0),
    );
    const cursorLine = buffer.baseY + buffer.cursorY;
    for (let line = start; line <= end; line += 1) {
      const marker: IMarker | undefined = terminal.registerMarker(line - cursorLine);
      if (!marker) {
        clearRows();
        return;
      }
      const decoration = terminal.registerDecoration({
        marker,
        width: terminal.cols,
        height: 1,
        layer: 'bottom',
      });
      if (!decoration) {
        marker.dispose();
        clearRows();
        return;
      }
      // xterm cell backgrounds cover only the marker row and omit trailing empty DOM cells.
      // A full-width translucent DOM decoration also highlights empty lines and offscreen starts.
      const rendered = decoration.onRender((element) => {
        element.classList.add('evermore-command-block-selection');
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
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      resized.dispose();
      clearRows();
    },
  };
}
