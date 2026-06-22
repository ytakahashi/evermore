import type {
  EvermoreAgentEvent,
  PaneRuntimeSignal,
  PaneRuntimeSignalLifecycleSource,
} from '../../shared/pane-runtime-signal';
import { OSC_777_PAYLOAD_MAX_BYTES } from '../../shared/pane-integration-constants';
import { decodeOsc633CommandLine } from '../../shared/shell-integration/osc633-decode';

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
  /**
   * Invoked when an OSC 777 Evermore agent-event payload is dropped, with a short reason string
   * (`'oversized payload'`, `'malformed JSON'`, etc.). The parser is intentionally logger-agnostic
   * — callers translate this into a `logger.debug` call, suppress it, or rate-limit it as needed.
   */
  onDropAgentEvent?: (reason: string) => void;
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
  private readonly onDropAgentEvent: ((reason: string) => void) | undefined;
  private state: ParserState = 'normal';
  private payload = '';

  public constructor(options: TerminalSignalParserOptions) {
    this.maxOscPayloadCodeUnits =
      options.maxOscPayloadCodeUnits ?? DEFAULT_MAX_OSC_PAYLOAD_CODE_UNITS;
    this.emit = options.emit;
    this.onDropAgentEvent = options.onDropAgentEvent;
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
    const signal = parseOscPayload(payload, (reason) => {
      this.safeDropAgentEvent(reason);
    });
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

  private safeDropAgentEvent(reason: string): void {
    try {
      this.onDropAgentEvent?.(reason);
    } catch (_error: unknown) {
      // Drop-observer failures must never block raw PTY data forwarding, mirroring safeEmit.
    }
  }
}

function parseOscPayload(
  payload: string,
  onDropAgentEvent: ((reason: string) => void) | undefined,
): PaneRuntimeSignal | null {
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

  if (payload.startsWith('777;evermore;')) {
    const event = parseEvermoreAgentEvent(payload.slice('777;evermore;'.length), onDropAgentEvent);
    return event ? { type: 'agent-event', source: 'evermore-osc777', event } : null;
  }

  return null;
}

function parseEvermoreAgentEvent(
  payload: string,
  onDropAgentEvent: ((reason: string) => void) | undefined,
): EvermoreAgentEvent | null {
  const drop = (reason: string): null => {
    onDropAgentEvent?.(reason);
    return null;
  };

  if (getUtf8ByteLength(payload) > OSC_777_PAYLOAD_MAX_BYTES) {
    return drop('oversized payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (_error: unknown) {
    // Ignore JSON parse errors for malformed agent event payloads
    // and drop them without disrupting the PTY flow.
    return drop('malformed JSON');
  }

  if (!isRecord(parsed)) {
    return drop('payload is not an object');
  }

  if (parsed['v'] !== 1) {
    return drop('unsupported version');
  }

  if (parsed['type'] !== 'agent-status') {
    return drop('unsupported event type');
  }

  const agent = normalizeAgentKind(parsed['agent']);
  if (!agent) {
    return drop('missing agent');
  }

  const status = parsed['status'];
  if (status !== 'running' && status !== 'awaiting-input' && status !== 'complete') {
    return drop('unsupported status');
  }

  return {
    v: 1,
    type: 'agent-status',
    agent,
    status,
    ...optionalStringField(parsed, 'message'),
    ...optionalStringField(parsed, 'event'),
    ...optionalStringField(parsed, 'sessionId'),
    ...optionalStringField(parsed, 'cwd'),
    ...optionalStringField(parsed, 'toolName'),
    ...(Object.hasOwn(parsed, 'toolInput') ? { toolInput: parsed['toolInput'] } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAgentKind(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function optionalStringField(
  payload: Record<string, unknown>,
  field: 'message' | 'event' | 'sessionId' | 'cwd' | 'toolName',
): Partial<Pick<EvermoreAgentEvent, typeof field>> {
  const value = payload[field];
  return typeof value === 'string' ? { [field]: value } : {};
}

const UTF8_ENCODER = new TextEncoder();

function getUtf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
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
