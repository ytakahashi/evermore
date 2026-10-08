import {
  Terminal,
  type IDecoration,
  type IDecorationOptions,
  type IDisposable,
} from '@xterm/xterm';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test';
import { attachCommandBlocks } from '../../../src/renderer/src/components/terminal/command-blocks';
import { TerminalCommandHistory } from '../../../src/renderer/src/components/terminal/command-history';
import { createTerminalHostRegistry } from '../../../src/renderer/src/terminal-host/terminalHostRegistry';

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}
function command(code = '0', output = 'result\r\n'): string {
  return (
    '\x1b]133;A\x07header\r\n\x1b]133;B\x07$ echo result\r\n' +
    '\x1b]633;E;echo result\x07\x1b]133;C\x07' +
    output +
    `\x1b]133;D;${code}\x07\x1b]133;A\x07\x1b]133;B\x07$ `
  );
}
type RegisteredDecoration = IDecoration & { options: IDecorationOptions };

interface DisplayFixture {
  terminal: Terminal;
  root: HTMLElement;
  home: HTMLElement;
  blocks: IDisposable;
  registered: MockInstance<Terminal['registerDecoration']>;
  decorations: () => RegisteredDecoration[];
  render: (decoration: IDecoration | undefined) => HTMLElement;
  dispose: () => void;
}
function fixture(): DisplayFixture {
  const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  const home = document.createElement('div');
  const root = document.createElement('div');
  document.body.appendChild(home);
  home.appendChild(root);
  // Only the display adapter is supplied in jsdom. Parsing, marker reflow, decoration lifecycle,
  // history, hover, copy controllers and attachment seams all remain the real implementations.
  vi.spyOn(terminal, 'element', 'get').mockReturnValue(root);
  const registered = vi.spyOn(terminal, 'registerDecoration');
  const blocks = attachCommandBlocks(terminal);
  return {
    terminal,
    root,
    home,
    registered,
    blocks,
    decorations: () =>
      registered.mock.results.flatMap((result) =>
        result.value && !result.value.isDisposed ? [result.value as RegisteredDecoration] : [],
      ),
    render: (decoration) => {
      if (!decoration) {
        throw new Error('Expected a registered decoration');
      }
      const element = document.createElement('div');
      root.appendChild(element);
      vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => {
        const top = (decoration.marker.line - terminal.buffer.active.viewportY) * 20;
        return {
          x: 5,
          y: top,
          left: 5,
          top,
          right: 805,
          bottom: top + 20,
          width: 800,
          height: 20,
          toJSON: () => ({}),
        };
      });
      // Drive the event emitted by xterm's DOM renderer, which is absent from a headless terminal.
      const rendered = decoration as IDecoration & {
        onRenderEmitter: { fire: (element: HTMLElement) => void };
      };
      decoration.element = element;
      decoration.onDispose(() => element.remove());
      rendered.onRenderEmitter.fire(element);
      return element;
    },
    dispose: () => {
      blocks.dispose();
      terminal.dispose();
      home.remove();
      root.remove();
    },
  };
}
function toolbar(f: DisplayFixture): RegisteredDecoration | undefined {
  return f
    .decorations()
    .find((value) => value.options.layer === 'top' && value.options.anchor !== 'right');
}

describe('command block display with real xterm and controllers', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['start', 'prompt', 'output-start', 'output-end', 'trim', 'owner'] as const)(
    'restores focused toolbar focus only for history removal: %s',
    async (reason) => {
      // Given: a real history entry has a focused toolbar in a connected display host.
      const f = fixture();
      const focused = vi.spyOn(f.terminal, 'focus').mockImplementation(() => undefined);
      try {
        await write(f.terminal, command());
        const host = f.render(toolbar(f));
        host.querySelector<HTMLButtonElement>('button')?.focus();

        // When: history's earlier listener handles any boundary removal or real scrollback trim.
        // All four history markers precede display markers; capture them before cleanup mutates the list.
        const boundaries = f.terminal.markers.slice(0, 4);
        if (reason === 'owner') {
          f.blocks.dispose();
        } else if (reason === 'trim') {
          await write(f.terminal, '\r\n'.repeat(1100));
          expect(boundaries[0]?.isDisposed).toBe(true);
        } else {
          const index = ['start', 'prompt', 'output-start', 'output-end'].indexOf(reason);
          boundaries[index]?.dispose();
        }

        // Then: history removal transfers focus once despite nested marker cleanup; owner teardown does not.
        expect(focused).toHaveBeenCalledTimes(reason === 'owner' ? 0 : 1);
        expect(f.decorations()).toHaveLength(0);
      } finally {
        f.dispose();
      }
    },
  );

  it.each([
    { code: '0', status: 'success' },
    { code: '4', status: 'error' },
    { code: '', status: 'unknown' },
  ])(
    'shows completion status $status across prompt/output rows and rebuilds after reflow',
    async ({ code, status }) => {
      // Given: a real OSC completion contains a multi-line prompt and output.
      const f = fixture();
      try {
        await write(f.terminal, command(code));
        const gauges = f.decorations().filter((value) => value.options.layer === 'bottom');

        // When: the gauge rows render, then terminal width changes and alternate-screen entry/return occurs.
        expect(gauges.map((value) => value.marker.line)).toEqual([0, 1, 2]);
        expect(f.render(gauges[1]).dataset.status).toBe(status);
        f.terminal.resize(40, 24);
        expect(gauges.every((value) => value.isDisposed)).toBe(true);
        await write(f.terminal, '\x1b[?1049h');
        expect(f.decorations()).toHaveLength(0);
        await write(f.terminal, '\x1b[?1049l');

        // Then: the same completed command returns with status, current toolbar width and gutter ownership.
        const restored = f.decorations().filter((value) => value.options.layer === 'bottom');
        expect(restored).toHaveLength(3);
        expect(f.render(restored[0]).dataset.status).toBe(status);
        expect(toolbar(f)?.options.width).toBe(40);
        expect(f.root).toHaveClass('evermore-command-blocks');
        f.blocks.dispose();
        expect(f.root).not.toHaveClass('evermore-command-blocks');
        expect(f.terminal.markers).toHaveLength(0);
      } finally {
        f.dispose();
      }
    },
  );

  it('retains newline-terminated wrapped output across narrowing and widening', async () => {
    // Given: one completed command has wrapped output and a newline boundary.
    const f = fixture();
    try {
      await write(f.terminal, command('0', 'x'.repeat(90) + '\r\n'));
      expect(f.decorations().filter((value) => value.options.layer === 'bottom')).toHaveLength(4);

      // When: narrower columns create a new wrapped row, then the original width is restored.
      f.terminal.resize(40, 24);
      expect(f.decorations().filter((value) => value.options.layer === 'bottom')).toHaveLength(5);
      f.terminal.resize(80, 24);

      // Then: the same block still owns the restored range and toolbar.
      expect(f.decorations().filter((value) => value.options.layer === 'bottom')).toHaveLength(4);
      expect(toolbar(f)).toBeDefined();
    } finally {
      f.dispose();
    }
  });

  it('keeps adjacent command boundaries distinct after zsh redraws a multi-line prompt', async () => {
    // Given: zsh erases below the cursor before drawing each multi-line prompt.
    const f = fixture();
    const prompt = '\x1b]133;A\x07\r\x1b[J\r\nheader\r\n$ \x1b]133;B\x07';
    const finish = '\x1b[7m%\x1b[0m' + ' '.repeat(79) + '\r \r\x1b]133;D;0\x07';
    try {
      await write(f.terminal, prompt);
      // When: task output and the next prompt arrive together in one parsed write.
      for (const name of ['lint', 'typecheck']) {
        await write(
          f.terminal,
          `pnpm run ${name}\r\n\x1b]633;E;pnpm run ${name}\x07\x1b]133;C\x07` +
            '\x1b[2m$ task\x1b[22m\r\nfinished\r\n' +
            finish +
            prompt,
        );
      }

      // Then: both completed blocks have their own cap and end gap; the active prompt has no gauge.
      const gauges = f.decorations().filter((value) => value.options.layer === 'bottom');
      expect(gauges.map((value) => value.marker.line)).toEqual(
        Array.from({ length: 10 }, (_, index) => index),
      );
      const edges = gauges.map((value) => {
        const element = f.render(value);
        return [element.dataset.start, element.dataset.end];
      });
      expect(edges.filter(([start]) => start === 'true')).toHaveLength(2);
      expect(edges.filter(([, end]) => end === 'true')).toHaveLength(2);
      expect(edges[4]).toEqual(['false', 'true']);
      expect(edges[5]).toEqual(['true', 'false']);
      f.terminal.scrollLines(-2);
      expect(f.render(gauges[1]).dataset.start).toBe('false');
    } finally {
      f.dispose();
    }
  });

  it('copies all three toolbar modes without changing text selection or keyboard navigation state', async () => {
    // Given: real history and copy controllers share a rendered multi-line-prompt toolbar.
    const clipboard = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
    const f = fixture();
    const selection = vi.fn();
    f.terminal.onSelectionChange(selection);
    try {
      await write(f.terminal, command());
      vi.useFakeTimers();
      const host = f.render(toolbar(f));
      expect(host.querySelector('[role=toolbar]')).toHaveAttribute(
        'aria-label',
        'Command actions (exit status 0)',
      );

      // When: each explicit mode is clicked without first selecting a block.
      for (const mode of ['command-and-output', 'output', 'command']) {
        host.querySelector<HTMLButtonElement>(`button[data-mode="${mode}"]`)?.click();
        await vi.advanceTimersByTimeAsync(0);
      }

      // Then: payloads use the same controller and feedback describes the last mode only.
      expect(clipboard.mock.calls).toEqual([
        ['$ echo result\nresult'],
        ['result'],
        ['echo result'],
      ]);
      expect(selection).not.toHaveBeenCalled();
      const feedback = f.decorations().find((value) => value.options.anchor === 'right');
      expect(f.render(feedback).querySelector('[role=status]')).toHaveAttribute(
        'aria-label',
        'Copied command',
      );
      await vi.advanceTimersByTimeAsync(1500);
      expect(feedback?.isDisposed).toBe(true);
    } finally {
      f.dispose();
    }
  });

  it('keeps command-only copying after invalidation and preserves the original feedback timeout across resize', async () => {
    // Given: a non-newline completion and a shared controller with persistent invalidation.
    const clipboard = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboard } });
    const f = fixture();
    try {
      await write(f.terminal, command('7', 'result'));
      vi.useFakeTimers();
      f.terminal.resize(40, 24);
      f.terminal.resize(80, 24);
      const host = f.render(toolbar(f));
      expect(host.querySelector('button[data-mode=output]')).toBeDisabled();
      expect(host.querySelector('button[data-mode=command-and-output]')).toBeDisabled();

      // When: command text is copied, then UI decorations are rebuilt partway through feedback.
      host.querySelector<HTMLButtonElement>('button[data-mode=command]')?.click();
      await vi.advanceTimersByTimeAsync(1000);
      f.terminal.resize(50, 24);
      const feedback = f.decorations().find((value) => value.options.anchor === 'right');
      expect(f.render(feedback).querySelector('[role=status]')).toHaveAttribute(
        'aria-label',
        'Copied command',
      );
      await vi.advanceTimersByTimeAsync(500);

      // Then: command-only survives reflow while output stays disabled and feedback expires on its original clock.
      expect(clipboard).toHaveBeenCalledExactlyOnceWith('echo result');
      expect(feedback?.isDisposed).toBe(true);
      expect(f.render(toolbar(f)).querySelector('button[data-mode=output]')).toBeDisabled();
    } finally {
      f.dispose();
    }
  });

  it('keeps the gutter and hover observer with a borrowed root and disposes them with the owner', async () => {
    // Given: an owned terminal root and a real host registry.
    const f = fixture();
    const registry = createTerminalHostRegistry();
    const borrowed = document.createElement('div');
    document.body.appendChild(borrowed);
    const unregister = registry.register('pane', {
      element: f.root,
      home: f.home,
      fit: () => undefined,
    });
    try {
      await write(f.terminal, command());
      vi.useFakeTimers();
      const host = f.render(toolbar(f));
      const release = registry.borrow('pane', borrowed);

      // When: pointer events arrive in the borrowed surface, then the root returns home.
      f.root.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 8 }));
      await vi.advanceTimersByTimeAsync(20);
      expect(host.querySelector('[role=toolbar]')).toHaveAttribute('data-hovered', 'true');
      release?.();
      f.blocks.dispose();

      // Then: borrowing has moved display only and owner cleanup removes the gutter and pending work.
      expect(f.root.parentElement).toBe(f.home);
      expect(f.root).not.toHaveClass('evermore-command-blocks');
      expect(f.terminal.markers).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(20);
      expect(host.querySelector('[role=toolbar]')).toBeNull();
    } finally {
      unregister();
      f.dispose();
      borrowed.remove();
    }
  });

  it('matches history-only retention when reflow reaches scrollback capacity', async () => {
    // Given: a display attachment and a history-only reference observe identical high-volume output.
    const f = fixture();
    const reference = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const history = new TerminalCommandHistory({ terminal: reference });
    try {
      const payload = Array.from({ length: 250 }, () => command('0', 'x'.repeat(90) + '\r\n')).join(
        '\r\n',
      );
      await Promise.all([write(f.terminal, payload), write(reference, payload)]);
      const retained = (): number =>
        f.decorations().filter((value) => value.options.layer === 'top').length;
      expect(retained()).toBe(history.getCompletedCommands().length);

      // When: a capacity-limited buffer reflows in both directions, potentially deleting boundary markers.
      for (const cols of [40, 80]) {
        f.terminal.resize(cols, 24);
        reference.resize(cols, 24);
        expect(retained()).toBe(history.getCompletedCommands().length);
      }

      // Then: extra row markers never reduce retention beyond the history controller's own invariant.
      f.blocks.dispose();
      history.dispose();
      expect(f.terminal.markers).toHaveLength(0);
      expect(reference.markers).toHaveLength(0);
    } finally {
      f.dispose();
      history.dispose();
      reference.dispose();
    }
  });

  it('releases gauges and markers under scrollback pressure and repeated reflow', async () => {
    // Given: hundreds of real completed commands approach the default scrollback capacity.
    const f = fixture();
    try {
      const payload = Array.from({ length: 150 }, () => command('0', 'x'.repeat(90) + '\r\n')).join(
        '\r\n',
      );
      const started = performance.now();
      await write(f.terminal, payload);
      const createdMs = performance.now() - started;
      const initial = f.decorations().length;

      // When: reflow repeatedly changes widths and trim removes old command anchors.
      const resizeStarted = performance.now();
      f.terminal.resize(40, 24);
      const afterNarrow = f.decorations().length;
      f.terminal.resize(80, 24);
      const resizeMs = performance.now() - resizeStarted;
      const afterResize = f.decorations().length;
      await write(f.terminal, '\r\n'.repeat(1100));

      // Then: decorations follow retained history and teardown leaves no row/history markers.
      expect(initial).toBe(750);
      expect(afterResize).toBe(initial);
      expect(f.decorations()).toHaveLength(0);
      f.blocks.dispose();
      expect(f.terminal.markers).toHaveLength(0);
      console.info('Command display headless measurement', {
        commands: 150,
        initial,
        afterResize,
        afterNarrow,
        createdMs: Math.round(createdMs),
        resizeMs: Math.round(resizeMs),
      });
    } finally {
      f.dispose();
    }
  });
});
