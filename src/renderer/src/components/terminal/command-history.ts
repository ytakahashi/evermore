import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { decodeOsc633CommandLine } from '../../../../shared/shell-integration/osc633-decode';
import {
  createTerminalOutputFingerprint,
  extractNormalizedTerminalOutput,
  type TerminalBufferBoundary,
  type TerminalOutputFingerprint,
} from './command-output';

export type { TerminalBufferBoundary } from './command-output';

interface PromptStartedState {
  blockStartMarker: IMarker;
  kind: 'prompt-started';
}

interface PromptReadyState {
  blockStartMarker: IMarker;
  kind: 'prompt-ready';
  promptMarker: IMarker;
}

interface CommandKnownState {
  blockStartMarker: IMarker;
  command: string;
  kind: 'command-known';
  promptMarker: IMarker;
}

interface RunningState {
  blockStartMarker: IMarker;
  command: string;
  kind: 'running';
  outputStart: TerminalBufferBoundary;
  promptMarker: IMarker;
}

type ActiveCommandState = PromptStartedState | PromptReadyState | CommandKnownState | RunningState;

interface PendingCommand {
  blockStartMarker: IMarker;
  command: string;
  outputEnd: TerminalBufferBoundary;
  outputStart: TerminalBufferBoundary;
  promptMarker: IMarker;
}

interface CommandMarkerSet {
  blockStartMarker: IMarker;
  outputEnd: TerminalBufferBoundary;
  outputStart: TerminalBufferBoundary;
  promptMarker: IMarker;
}

interface StoredCommand {
  entry: TerminalCommandHistoryEntry;
  markerDisposables: IDisposable[];
}

export interface TerminalCommandHistoryEntry {
  /** Renderer-local identifier that remains stable until the entry is removed. */
  id: string;
  /** Exact command line decoded from OSC 633;E. */
  command: string;
  /** Prompt start captured at OSC 133;A, falling back to the input marker when A is absent. */
  blockStartMarker: IMarker;
  /** Marker used later to anchor the command's copy decoration. */
  promptMarker: IMarker;
  /** First output buffer position captured at OSC 133;C. */
  outputStart: TerminalBufferBoundary;
  /** Exclusive output buffer position captured at OSC 133;D. */
  outputEnd: TerminalBufferBoundary;
  /** Compact completion-time identity of the normalized output; the output itself is not stored. */
  outputFingerprint: TerminalOutputFingerprint;
  /** Terminal width used to invalidate non-newline-terminated output after reflow. */
  completionCols: number;
  /** Whether OSC 133;D arrived at column zero, indicating newline-terminated output. */
  endsAtLineStart: boolean;
}

export interface TerminalCommandHistoryOptions {
  terminal: Terminal;
  onCommandCompleted?: (entry: TerminalCommandHistoryEntry) => void;
  onCommandRemoved?: (entry: TerminalCommandHistoryEntry) => void;
}

let nextCommandId = 0;

/**
 * Tracks completed shell commands from xterm's OSC stream without retaining command output.
 *
 * The controller owns only command text and xterm markers. Completed entries become visible after
 * the write containing OSC 133;D has fully parsed, ensuring all output from that write is present
 * in the terminal buffer. Output extraction and decorations are intentionally left to later
 * phases.
 */
export class TerminalCommandHistory {
  private readonly terminal: Terminal;
  private readonly onCommandCompleted: ((entry: TerminalCommandHistoryEntry) => void) | undefined;
  private readonly onCommandRemoved: ((entry: TerminalCommandHistoryEntry) => void) | undefined;
  private readonly disposables: IDisposable[];
  private readonly completed: StoredCommand[] = [];
  private readonly pending: PendingCommand[] = [];
  private active: ActiveCommandState | null = null;
  private disposed = false;

  public constructor(options: TerminalCommandHistoryOptions) {
    this.terminal = options.terminal;
    this.onCommandCompleted = options.onCommandCompleted;
    this.onCommandRemoved = options.onCommandRemoved;
    this.disposables = [
      this.terminal.parser.registerOscHandler(133, (data) => {
        this.applyOsc133(data);
        // Remain a read-only observer so another xterm integration can also consume OSC 133.
        return false;
      }),
      this.terminal.parser.registerOscHandler(633, (data) => {
        this.applyOsc633(data);
        // Remain a read-only observer so another xterm integration can also consume OSC 633.
        return false;
      }),
      this.terminal.onWriteParsed(() => {
        this.finalizePendingCommands();
      }),
      this.terminal.buffer.onBufferChange((buffer) => {
        // Prompt editors may use the alternate screen before the command starts executing.
        if (buffer.type === 'alternate' && this.active?.kind === 'running') {
          this.discardActive();
        }
      }),
    ];
  }

  /**
   * Returns completed commands whose boundary markers are still present in xterm's normal buffer.
   */
  public getCompletedCommands(): readonly TerminalCommandHistoryEntry[] {
    return this.completed.map(({ entry }) => entry);
  }

  /**
   * Releases OSC handlers, markers, and pending/completed command metadata owned by this terminal.
   */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.discardActive();

    for (const command of this.pending.splice(0)) {
      disposeCommandMarkers(command);
    }

    for (const stored of this.completed.splice(0)) {
      this.disposeStoredCommand(stored, false);
    }
  }

  private applyOsc133(data: string): void {
    if (this.disposed) {
      return;
    }

    const marker = data.split(';', 1)[0];
    switch (marker) {
      case 'A':
        this.beginPromptStart();
        return;
      case 'B':
        this.beginPrompt();
        return;
      case 'C':
        this.beginCommand();
        return;
      case 'D':
        this.finishCommand();
        return;
    }
  }

  private applyOsc633(data: string): void {
    if (this.disposed || !data.startsWith('E;')) {
      return;
    }

    if (this.active?.kind !== 'prompt-ready') {
      this.discardActive();
      return;
    }

    const encodedCommand = data.slice('E;'.length).split(';', 1)[0];
    const command = decodeOsc633CommandLine(encodedCommand);
    if (!command) {
      this.discardActive();
      return;
    }

    this.active = {
      kind: 'command-known',
      command,
      blockStartMarker: this.active.blockStartMarker,
      promptMarker: this.active.promptMarker,
    };
  }

  private beginPromptStart(): void {
    this.discardActive();
    if (this.terminal.buffer.active.type !== 'normal') {
      return;
    }
    this.active = {
      kind: 'prompt-started',
      blockStartMarker: this.terminal.registerMarker(0),
    };
  }

  private beginPrompt(): void {
    // Transfer A's marker before discarding any incomplete cycle; B may be several rows below A.
    const blockStartMarker =
      this.active?.kind === 'prompt-started' ? this.active.blockStartMarker : null;
    if (blockStartMarker) {
      this.active = null;
    } else {
      this.discardActive();
    }
    if (this.terminal.buffer.active.type !== 'normal') {
      blockStartMarker?.dispose();
      return;
    }

    const promptMarker = this.terminal.registerMarker(0);
    this.active = {
      kind: 'prompt-ready',
      blockStartMarker: blockStartMarker ?? promptMarker,
      promptMarker,
    };
  }

  private beginCommand(): void {
    if (this.active?.kind !== 'command-known' || this.terminal.buffer.active.type !== 'normal') {
      this.discardActive();
      return;
    }

    this.active = {
      kind: 'running',
      command: this.active.command,
      outputStart: {
        column: this.terminal.buffer.active.cursorX,
        marker: this.terminal.registerMarker(0),
      },
      blockStartMarker: this.active.blockStartMarker,
      promptMarker: this.active.promptMarker,
    };
  }

  private finishCommand(): void {
    if (this.active?.kind !== 'running' || this.terminal.buffer.active.type !== 'normal') {
      this.discardActive();
      return;
    }

    this.pending.push({
      command: this.active.command,
      outputEnd: {
        column: this.terminal.buffer.active.cursorX,
        marker: this.terminal.registerMarker(0),
      },
      outputStart: this.active.outputStart,
      blockStartMarker: this.active.blockStartMarker,
      promptMarker: this.active.promptMarker,
    });
    this.active = null;
  }

  private finalizePendingCommands(): void {
    if (this.disposed) {
      return;
    }

    for (const command of this.pending.splice(0)) {
      if (hasDisposedMarker(command)) {
        disposeCommandMarkers(command);
        continue;
      }

      const output = extractNormalizedTerminalOutput(this.terminal.buffer.normal, command);
      if (output === null) {
        disposeCommandMarkers(command);
        continue;
      }

      const entry: TerminalCommandHistoryEntry = {
        id: `terminal-command-${++nextCommandId}`,
        command: command.command,
        blockStartMarker: command.blockStartMarker,
        promptMarker: command.promptMarker,
        outputStart: command.outputStart,
        outputEnd: command.outputEnd,
        outputFingerprint: createTerminalOutputFingerprint(output),
        completionCols: this.terminal.cols,
        endsAtLineStart: command.outputEnd.column === 0,
      };
      const stored: StoredCommand = {
        entry,
        markerDisposables: [],
      };
      stored.markerDisposables = getCommandMarkers(entry).map((marker) =>
        marker.onDispose(() => {
          this.removeCompletedCommand(stored);
        }),
      );
      this.completed.push(stored);
      this.onCommandCompleted?.(entry);
    }
  }

  private discardActive(): void {
    if (!this.active) {
      return;
    }

    this.active.blockStartMarker.dispose();
    if (
      this.active.kind !== 'prompt-started' &&
      this.active.promptMarker !== this.active.blockStartMarker
    ) {
      this.active.promptMarker.dispose();
    }
    if (this.active.kind === 'running') {
      this.active.outputStart.marker.dispose();
    }
    this.active = null;
  }

  private removeCompletedCommand(stored: StoredCommand): void {
    const index = this.completed.indexOf(stored);
    if (index < 0) {
      return;
    }

    this.completed.splice(index, 1);
    this.disposeStoredCommand(stored, true);
  }

  private disposeStoredCommand(stored: StoredCommand, notify: boolean): void {
    for (const disposable of stored.markerDisposables) {
      disposable.dispose();
    }
    for (const marker of getCommandMarkers(stored.entry)) {
      if (!marker.isDisposed) {
        marker.dispose();
      }
    }
    if (notify) {
      this.onCommandRemoved?.(stored.entry);
    }
  }
}

function getCommandMarkers(command: CommandMarkerSet): IMarker[] {
  // The A-missing fallback shares the input marker; subscribe and dispose only once per marker.
  return [
    ...new Set([
      command.blockStartMarker,
      command.promptMarker,
      command.outputStart.marker,
      command.outputEnd.marker,
    ]),
  ];
}

function disposeCommandMarkers(command: PendingCommand): void {
  for (const marker of getCommandMarkers(command)) {
    if (!marker.isDisposed) {
      marker.dispose();
    }
  }
}

function hasDisposedMarker(command: PendingCommand): boolean {
  return getCommandMarkers(command).some((marker) => marker.isDisposed);
}
