import type { IMarker, Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { TerminalCommandToolbarHover } from './command-toolbar-hover';

const helpers: TerminalCommandToolbarHover[] = [];
function fixture(): {
  root: HTMLElement;
  terminal: Terminal;
  helper: TerminalCommandToolbarHover;
  events: (() => void)[];
  removed: ReturnType<typeof vi.fn>[];
  move: (y: number, buttons?: number) => void;
  host: (line: number) => {
    element: HTMLElement;
    changed: ReturnType<typeof vi.fn>;
    dispose: () => void;
  };
} {
  vi.useFakeTimers();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const events: (() => void)[] = [];
  const removed: ReturnType<typeof vi.fn>[] = [];
  const subscribe = (listener: () => void): { dispose: ReturnType<typeof vi.fn> } => {
    events.push(listener);
    const dispose = vi.fn();
    removed.push(dispose);
    return { dispose };
  };
  const terminal = {
    element: root,
    buffer: { active: { type: 'normal' }, onBufferChange: subscribe },
    onResize: subscribe,
    onScroll: subscribe,
    onRender: subscribe,
  } as unknown as Terminal;
  const helper = new TerminalCommandToolbarHover(terminal);
  helpers.push(helper);
  return {
    root,
    terminal,
    helper,
    events,
    removed,
    move: (y, buttons = 0) =>
      root.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: y, buttons })),
    host: (line) => {
      const element = document.createElement('div');
      root.appendChild(element);
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        x: 10,
        y: line * 20,
        left: 10,
        top: line * 20,
        width: 100,
        height: 20,
        right: 110,
        bottom: (line + 1) * 20,
        toJSON: () => ({}),
      });
      const changed = vi.fn();
      const registration = helper.register({ line, isDisposed: false } as IMarker, changed);
      registration.setElement(element);
      return { element, changed, dispose: () => registration.dispose() };
    },
  };
}

describe('TerminalCommandToolbarHover', () => {
  afterEach(() => {
    for (const helper of helpers.splice(0)) {
      helper.dispose();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('coalesces pointer movement and rechecks a stationary pointer after renderer changes', async () => {
    // Given: two visible first-row hosts and a terminal-level pointer observer.
    const f = fixture();
    const first = f.host(0);
    const next = f.host(1);

    // When: several moves occur in one frame, then a scroll changes the first host's geometry.
    f.move(4);
    f.move(8);
    await vi.advanceTimersByTimeAsync(20);
    expect(first.changed).toHaveBeenCalledExactlyOnceWith(true, true);
    vi.spyOn(first.element, 'getBoundingClientRect').mockReturnValue(
      next.element.getBoundingClientRect(),
    );
    f.events[0]?.();
    await vi.advanceTimersByTimeAsync(20);

    // Then: the old row loses hover without intercepting a pointer event or needing a new move.
    expect(first.changed).toHaveBeenLastCalledWith(false, true);
    expect(next.changed).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'detached', 'alternate', 'drag', 'leave'] as const)(
    'removes hover for %s',
    async (reason) => {
      // Given: a first row is hovered.
      const f = fixture();
      const host = f.host(0);
      f.move(5);
      await vi.advanceTimersByTimeAsync(20);

      // When: it becomes ineligible for an interactive toolbar.
      if (reason === 'hidden') {
        host.element.style.display = 'none';
      }
      if (reason === 'detached') {
        host.element.remove();
      }
      if (reason === 'alternate') {
        Object.assign(f.terminal.buffer.active, { type: 'alternate' });
      }
      if (reason === 'drag') {
        f.move(5, 1);
      }
      if (reason === 'leave') {
        f.root.dispatchEvent(new MouseEvent('pointerleave'));
      }
      f.helper.refresh();
      await vi.advanceTimersByTimeAsync(20);

      // Then: hover is withdrawn while the text selection/default event path remains available.
      expect(host.changed).toHaveBeenLastCalledWith(false, true);
    },
  );
  it('keeps shared-row precedence stable across DOM replacement and exposes the previous entry on removal', async () => {
    // Given: successive commands share a physical prompt row.
    const f = fixture();
    const older = f.host(0);
    const newer = f.host(0);

    // When: the row is hovered, then the newest command is removed.
    f.move(5);
    await vi.advanceTimersByTimeAsync(20);
    expect(older.changed).toHaveBeenLastCalledWith(false, false);
    expect(newer.changed).toHaveBeenLastCalledWith(true, true);
    newer.dispose();
    await vi.advanceTimersByTimeAsync(20);

    // Then: precedence belongs to completion order and removal restores the older command.
    expect(older.changed).toHaveBeenLastCalledWith(true, true);
  });
  it('cancels pending frames and subscriptions and keeps borrowed-root events attached', async () => {
    // Given: the same xterm root moves into a temporary display host.
    const f = fixture();
    const host = f.host(0);
    const borrowed = document.createElement('div');
    document.body.appendChild(borrowed);
    borrowed.appendChild(f.root);
    f.move(5);
    await vi.advanceTimersByTimeAsync(20);
    expect(host.changed).toHaveBeenCalledWith(true, true);

    // When: disposal occurs with frame work still pending and events arrive afterward.
    f.move(30);
    f.helper.dispose();
    f.helper.dispose();
    host.changed.mockClear();
    f.move(5);
    await vi.advanceTimersByTimeAsync(20);

    // Then: root relocation never adds ownership and cleanup prevents late notifications.
    expect(host.changed).not.toHaveBeenCalled();
    expect(f.removed.every((value) => value.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
