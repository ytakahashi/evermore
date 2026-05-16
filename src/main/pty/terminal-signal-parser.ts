import type {
  PaneRuntimeSignal,
  PaneRuntimeSignalLifecycleSource,
} from '../../shared/pane-runtime-signal';

const ESC = '\x1b';
const BEL = '\x07';
const ST_FINAL = '\\';
const DEFAULT_MAX_OSC_PAYLOAD_CODE_UNITS = 8192;

type ParserState =
  | 'normal'
  | 'esc-seen'
  | 'osc-payload'
  | 'osc-esc-seen'
  | 'osc-discard'
  | 'osc-discard-esc-seen';

export interface TerminalSignalParserOptions {
  /**
   * Maximum OSC payload length in UTF-16 code units before the payload is discarded.
   */
  maxOscPayloadCodeUnits?: number;
  /**
   * Receives a typed signal whenever a known OSC sequence is observed.
   */
  emit: (signal: PaneRuntimeSignal) => void;
}

/**
 * Observes a PTY data stream and emits typed runtime signals for supported OSC sequences.
 *
 * The parser is a read-only tap: it never returns or mutates terminal output, and malformed
 * sequences are silently dropped so terminal rendering can continue unaffected.
 */
export class TerminalSignalParser {
  private readonly maxOscPayloadCodeUnits: number;
  private readonly emit: (signal: PaneRuntimeSignal) => void;
  private state: ParserState = 'normal';
  private payload = '';

  public constructor(options: TerminalSignalParserOptions) {
    this.maxOscPayloadCodeUnits =
      options.maxOscPayloadCodeUnits ?? DEFAULT_MAX_OSC_PAYLOAD_CODE_UNITS;
    this.emit = options.emit;
  }

  /**
   * Applies a PTY data chunk to the parser without changing the raw terminal data.
   */
  public applyChunk(data: string): void {
    if (this.state === 'normal' && !data.includes(ESC)) {
      return;
    }

    for (const char of data) {
      this.applyChar(char);
    }
  }

  /**
   * Discards any incomplete OSC payload retained across chunk boundaries.
   */
  public dispose(): void {
    this.state = 'normal';
    this.payload = '';
  }

  private applyChar(char: string): void {
    switch (this.state) {
      case 'normal':
        if (char === ESC) {
          this.state = 'esc-seen';
        }
        return;

      case 'esc-seen':
        if (char === ']') {
          this.payload = '';
          this.state = 'osc-payload';
        } else {
          this.state = 'normal';
        }
        return;

      case 'osc-payload':
        this.applyOscPayloadChar(char);
        return;

      case 'osc-esc-seen':
        this.applyOscEscSeenChar(char);
        return;

      case 'osc-discard':
        if (char === BEL) {
          this.state = 'normal';
        } else if (char === ESC) {
          this.state = 'osc-discard-esc-seen';
        }
        return;

      case 'osc-discard-esc-seen':
        this.state = char === ST_FINAL ? 'normal' : 'osc-discard';
        return;
    }
  }

  private applyOscPayloadChar(char: string): void {
    if (char === BEL) {
      this.dispatchPayload(this.payload);
      this.payload = '';
      this.state = 'normal';
      return;
    }

    if (char === ESC) {
      this.state = 'osc-esc-seen';
      return;
    }

    this.payload += char;
    if (this.payload.length > this.maxOscPayloadCodeUnits) {
      this.payload = '';
      this.state = 'osc-discard';
    }
  }

  private applyOscEscSeenChar(char: string): void {
    if (char === ST_FINAL) {
      this.dispatchPayload(this.payload);
      this.payload = '';
      this.state = 'normal';
      return;
    }

    if (char === ']') {
      this.payload = '';
      this.state = 'osc-payload';
      return;
    }

    this.state = 'osc-payload';
  }

  private dispatchPayload(payload: string): void {
    const signal = parseOscPayload(payload);
    if (signal) {
      this.safeEmit(signal);
    }
  }

  private safeEmit(signal: PaneRuntimeSignal): void {
    try {
      this.emit(signal);
    } catch (_error: unknown) {
      // Signal observation must never block raw PTY data forwarding.
    }
  }
}

function parseOscPayload(payload: string): PaneRuntimeSignal | null {
  if (payload.startsWith('7;')) {
    const cwd = parseOsc7Cwd(payload.slice(2));
    return cwd ? { type: 'cwd', cwd, source: 'osc7' } : null;
  }

  const lifecycleSignal = parseLifecycleSignal(payload);
  if (lifecycleSignal) {
    return lifecycleSignal;
  }

  if (payload.startsWith('633;E;')) {
    const command = parseOsc633CommandLine(payload.slice('633;E;'.length));
    return command ? { type: 'shell-command-line', command, source: 'osc633' } : null;
  }

  return null;
}

function parseLifecycleSignal(payload: string): PaneRuntimeSignal | null {
  const segments = payload.split(';');
  const namespace = segments[0];
  if (namespace !== '133' && namespace !== '633') {
    return null;
  }

  const source: PaneRuntimeSignalLifecycleSource = namespace === '133' ? 'osc133' : 'osc633';

  switch (segments[1]) {
    case 'A':
      return { type: 'shell-prompt-start', source };
    case 'B':
      return { type: 'shell-prompt-end', source };
    case 'C':
      return { type: 'shell-command-started', source };
    case 'D':
      return parseCommandFinishedSignal(source, segments[2]);
    default:
      return null;
  }
}

function parseCommandFinishedSignal(
  source: PaneRuntimeSignalLifecycleSource,
  exitCodePayload: string | undefined,
): PaneRuntimeSignal {
  if (exitCodePayload === undefined || !/^-?\d+$/.test(exitCodePayload)) {
    return { type: 'shell-command-finished', source };
  }

  return {
    type: 'shell-command-finished',
    source,
    exitCode: Number(exitCodePayload),
  };
}

function parseOsc7Cwd(payload: string): string | null {
  const rawPath = getOsc7Path(payload);
  if (!rawPath) {
    return null;
  }

  try {
    const cwd = decodeURIComponent(rawPath);
    return cwd.startsWith('/') ? cwd : null;
  } catch (_error: unknown) {
    // Invalid percent-encoding in terminal output should not affect terminal rendering.
    return null;
  }
}

function getOsc7Path(payload: string): string | null {
  if (payload.startsWith('file://')) {
    try {
      const url = new URL(payload);
      return url.protocol === 'file:' ? url.pathname : null;
    } catch (_error: unknown) {
      return null;
    }
  }

  return payload;
}

function parseOsc633CommandLine(payload: string): string | null {
  const encodedCommand = payload.split(';', 1)[0];
  if (!encodedCommand) {
    return null;
  }

  const command = decodeOsc633CommandLine(encodedCommand);
  return command === '' ? null : command;
}

function decodeOsc633CommandLine(encodedCommand: string): string | null {
  let decoded = '';

  for (let index = 0; index < encodedCommand.length; index += 1) {
    const char = encodedCommand[index];
    if (char !== '\\') {
      decoded += char;
      continue;
    }

    const next = encodedCommand[index + 1];
    if (next === '\\') {
      decoded += '\\';
      index += 1;
      continue;
    }

    if (next === 'x') {
      const hex = encodedCommand.slice(index + 2, index + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 3;
        continue;
      }
    }

    return null;
  }

  return decoded;
}
