/**
 * Main-process logging primitives.
 *
 * The Logger is an internal main-process concern and is not exposed across the IPC boundary; it
 * deliberately does not live in `shared/`. Transports are pluggable so the composition root can
 * fan out to console, file, or test sinks without changing call sites.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  /** Nested scopes are flattened to a single colon-separated string. */
  scope: string;
  message: string;
  /** Optional structured payload. Transports must accept any value, including `Error`. */
  meta?: unknown;
  /** Epoch milliseconds, injected by `createLogger` via the `now` option. */
  timestamp: number;
}

export interface LogTransport {
  /**
   * Writes a log record. Implementations must not throw; failures must be swallowed (or routed to
   * a fallback transport) so that one failing transport does not break the others.
   */
  write(record: LogRecord): void;
  /**
   * Releases synchronous resources only. Pending asynchronous writes are best-effort; shutdown
   * must not wait on transport-level flushes because the current app cleanup chain is synchronous.
   */
  dispose?(): void;
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  /** Returns a child logger whose scope is appended to the parent's via `:`. */
  child(scope: string): Logger;
}

export interface CreateLoggerOptions {
  level: LogLevel;
  transport: LogTransport;
  scope?: string;
  now?: () => number;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Creates a Logger bound to the supplied transport, level threshold, and scope.
 *
 * The returned logger is immutable: `child()` allocates a new logger that shares the transport,
 * threshold, and clock with its parent and only differs in the joined scope.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const threshold = LEVEL_ORDER[options.level];
  const transport = options.transport;
  const now = options.now ?? Date.now;
  const scope = options.scope ?? '';

  const writeAt = (level: LogLevel, message: string, meta?: unknown): void => {
    if (LEVEL_ORDER[level] < threshold) {
      return;
    }

    const record: LogRecord =
      meta === undefined
        ? { level, scope, message, timestamp: now() }
        : { level, scope, message, meta, timestamp: now() };

    try {
      transport.write(record);
    } catch (_error: unknown) {
      // A misbehaving transport must never propagate into call sites. Failures here are
      // intentionally swallowed; cross-transport fan-out and fallback live in MultiTransport.
    }
  };

  const buildChildScope = (childScope: string): string => {
    if (!childScope) {
      return scope;
    }

    return scope ? `${scope}:${childScope}` : childScope;
  };

  const logger: Logger = {
    debug: (message: string, meta?: unknown) => writeAt('debug', message, meta),
    info: (message: string, meta?: unknown) => writeAt('info', message, meta),
    warn: (message: string, meta?: unknown) => writeAt('warn', message, meta),
    error: (message: string, meta?: unknown) => writeAt('error', message, meta),
    child: (childScope: string): Logger =>
      createLogger({
        level: options.level,
        transport,
        scope: buildChildScope(childScope),
        now,
      }),
  };

  return logger;
}

/**
 * Returns a logger that swallows every record. Suitable as a constructor default for managers
 * that take an optional logger so tests do not need to wire one and unwired call sites do not
 * leak diagnostics through `console`.
 */
export function createSilentLogger(): Logger {
  return createLogger({ level: 'error', transport: silentTransport });
}

const silentTransport: LogTransport = {
  write(): void {
    // Intentional no-op.
  },
};

/**
 * Resolves the effective log level from an environment variable string and the dev/prod flag.
 *
 * `LOG_LEVEL` overrides when it is one of the four valid values. Missing or invalid input falls
 * back silently — dev defaults to `debug` so OSC 777 drops and similar diagnostics surface during
 * development, and production defaults to `info`. No warning is emitted for invalid values because
 * the logger is being constructed and is not yet usable.
 */
export function resolveLogLevel(envValue: string | undefined, isDev: boolean): LogLevel {
  if (envValue === 'debug' || envValue === 'info' || envValue === 'warn' || envValue === 'error') {
    return envValue;
  }

  return isDev ? 'debug' : 'info';
}
