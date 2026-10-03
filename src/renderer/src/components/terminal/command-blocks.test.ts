import type { Terminal } from '@xterm/xterm';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { attachCommandBlocks } from './command-blocks';

const integrationMock = vi.hoisted(() => {
  interface Entry {
    id: string;
  }

  interface HistoryOptions {
    terminal: unknown;
    onCommandCompleted: (entry: Entry) => void;
    onCommandRemoved: (entry: Entry) => void;
  }

  class MockTerminalCommandHistory {
    public readonly dispose = vi.fn();
    public readonly options: HistoryOptions;

    public constructor(options: HistoryOptions) {
      this.options = options;
      integrationMock.historyInstances.push(this);
    }

    public emitCompleted(entry: Entry): void {
      this.options.onCommandCompleted(entry);
    }

    public emitRemoved(entry: Entry): void {
      this.options.onCommandRemoved(entry);
    }
  }

  return {
    historyInstances: [] as MockTerminalCommandHistory[],
    MockTerminalCommandHistory,
    createDecoration: vi.fn(),
  };
});

vi.mock('./command-history', () => ({
  TerminalCommandHistory: integrationMock.MockTerminalCommandHistory,
}));

vi.mock('./command-copy-decoration', () => ({
  createTerminalCommandCopyDecoration: integrationMock.createDecoration,
}));

describe('attachCommandBlocks', () => {
  const terminal = {} as Terminal;

  beforeEach(() => {
    integrationMock.historyInstances.length = 0;
    integrationMock.createDecoration.mockReset();
  });

  it('creates a copy decoration for a completed command and disposes it when removed', () => {
    // Given: a terminal with a command history observer.
    const decoration = { dispose: vi.fn() };
    integrationMock.createDecoration.mockReturnValue(decoration);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };

    // When: the command completes and is removed from history.
    history?.emitCompleted(entry);
    history?.emitRemoved(entry);

    // Then: the decoration uses the same terminal and is released once.
    expect(history?.options.terminal).toBe(terminal);
    expect(integrationMock.createDecoration).toHaveBeenCalledWith({
      terminal,
      entry,
      onDisposed: expect.any(Function),
    });
    expect(decoration.dispose).toHaveBeenCalledOnce();
    blocks.dispose();
    expect(decoration.dispose).toHaveBeenCalledOnce();
  });

  it('replaces a previous decoration for an unexpected duplicate completion', () => {
    // Given: the first completion has a live decoration.
    const previous = { dispose: vi.fn() };
    const replacement = { dispose: vi.fn() };
    integrationMock.createDecoration.mockReturnValueOnce(previous).mockReturnValueOnce(replacement);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };
    history?.emitCompleted(entry);

    // When: the same id completes again.
    history?.emitCompleted(entry);

    // Then: only the replacement remains owned by the attachment.
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(replacement.dispose).not.toHaveBeenCalled();
    blocks.dispose();
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });

  it('forgets a decoration that disposes itself', () => {
    // Given: a copy decoration reports its own disposal.
    const decoration = { dispose: vi.fn() };
    integrationMock.createDecoration.mockReturnValue(decoration);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };
    history?.emitCompleted(entry);
    const onDisposed = integrationMock.createDecoration.mock.calls[0]?.[0].onDisposed as
      | (() => void)
      | undefined;

    // When: xterm disposes the decoration before history removes the command.
    onDisposed?.();
    history?.emitRemoved(entry);
    blocks.dispose();

    // Then: cleanup does not dispose it again.
    expect(decoration.dispose).not.toHaveBeenCalled();
  });

  it('keeps cleanup safe when xterm cannot create a decoration', () => {
    // Given: xterm cannot create a decoration for a completed command.
    integrationMock.createDecoration.mockReturnValue(null);
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    const entry = { id: 'command-1' };

    // When: the command completes, is removed, and the attachment is disposed.
    history?.emitCompleted(entry);
    history?.emitRemoved(entry);
    blocks.dispose();

    // Then: no decoration is retained and history is released normally.
    expect(integrationMock.createDecoration).toHaveBeenCalledOnce();
    expect(history?.dispose).toHaveBeenCalledOnce();
  });

  it('disposes remaining decorations before command history', () => {
    // Given: two completed commands still have decorations.
    const order: string[] = [];
    integrationMock.createDecoration
      .mockReturnValueOnce({ dispose: () => order.push('decoration-1') })
      .mockReturnValueOnce({ dispose: () => order.push('decoration-2') });
    const blocks = attachCommandBlocks(terminal);
    const history = integrationMock.historyInstances[0];
    history?.dispose.mockImplementation(() => {
      order.push('history');
    });
    history?.emitCompleted({ id: 'command-1' });
    history?.emitCompleted({ id: 'command-2' });

    // When: the attachment is disposed.
    blocks.dispose();

    // Then: both decorations are released before their history observer.
    expect(order).toEqual(['decoration-1', 'decoration-2', 'history']);
    expect(history?.dispose).toHaveBeenCalledOnce();
  });
});
