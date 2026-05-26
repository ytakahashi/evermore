import { describe, expect, it } from 'vitest';
import { createLogger, resolveLogLevel, type LogRecord, type LogTransport } from './logger';

interface RecordingTransport extends LogTransport {
  records: LogRecord[];
}

function createRecordingTransport(): RecordingTransport {
  const records: LogRecord[] = [];
  return {
    records,
    write(record: LogRecord): void {
      records.push(record);
    },
  };
}

describe('createLogger', () => {
  it('filters records below the configured level', () => {
    // Given a logger configured at info level.
    const transport = createRecordingTransport();
    const logger = createLogger({ level: 'info', transport });

    // When the caller logs at every level.
    logger.debug('hidden');
    logger.info('visible-info');
    logger.warn('visible-warn');
    logger.error('visible-error');

    // Then only info and above reach the transport.
    expect(transport.records.map((record) => record.level)).toEqual(['info', 'warn', 'error']);
  });

  it('emits the record fields the transport contract requires', () => {
    // Given a logger with an injected clock and scope.
    const transport = createRecordingTransport();
    const logger = createLogger({
      level: 'debug',
      transport,
      scope: 'root',
      now: () => 1234,
    });

    // When a record is written.
    logger.info('hello', { extra: 1 });

    // Then level, scope, message, meta, and timestamp are populated.
    expect(transport.records).toEqual([
      {
        level: 'info',
        scope: 'root',
        message: 'hello',
        meta: { extra: 1 },
        timestamp: 1234,
      },
    ]);
  });

  it('omits the meta field when no meta is provided', () => {
    // Given a logger.
    const transport = createRecordingTransport();
    const logger = createLogger({ level: 'debug', transport });

    // When a record is written without meta.
    logger.info('no-meta');

    // Then the record has no meta property at all (not just undefined).
    expect(Object.hasOwn(transport.records[0]!, 'meta')).toBe(false);
  });

  it('passes meta values through unchanged, including Error instances', () => {
    // Given a logger.
    const transport = createRecordingTransport();
    const logger = createLogger({ level: 'debug', transport });
    const error = new Error('boom');

    // When an Error is logged as meta.
    logger.error('failure', error);

    // Then the Error instance is preserved as-is (not stringified).
    expect(transport.records[0]?.meta).toBe(error);
  });

  describe('child', () => {
    it('joins scopes with a colon separator', () => {
      // Given a logger with a root scope.
      const transport = createRecordingTransport();
      const logger = createLogger({ level: 'debug', transport, scope: 'evermore' });

      // When a nested child is created.
      const child = logger.child('pty').child('signal-parser');
      child.info('msg');

      // Then the joined scope is parent:child:grandchild.
      expect(transport.records[0]?.scope).toBe('evermore:pty:signal-parser');
    });

    it('uses the child scope alone when the parent scope is empty', () => {
      // Given a logger with no scope.
      const transport = createRecordingTransport();
      const logger = createLogger({ level: 'debug', transport });

      // When a child is created.
      const child = logger.child('pty');
      child.info('msg');

      // Then the scope equals the child name without a leading separator.
      expect(transport.records[0]?.scope).toBe('pty');
    });

    it('preserves the parent scope when child scope is empty', () => {
      // Given a logger with a root scope.
      const transport = createRecordingTransport();
      const logger = createLogger({ level: 'debug', transport, scope: 'root' });

      // When a child is created with an empty scope.
      const child = logger.child('');
      child.info('msg');

      // Then the parent scope is reused untouched.
      expect(transport.records[0]?.scope).toBe('root');
    });

    it('inherits the level threshold from the parent', () => {
      // Given an info-level parent.
      const transport = createRecordingTransport();
      const logger = createLogger({ level: 'info', transport, scope: 'root' });

      // When a child logs at debug.
      logger.child('child').debug('hidden');
      logger.child('child').info('shown');

      // Then debug is filtered just like on the parent.
      expect(transport.records.map((record) => record.message)).toEqual(['shown']);
    });
  });

  it('swallows transport failures so call sites cannot crash from logging', () => {
    // Given a transport that always throws.
    const throwingTransport: LogTransport = {
      write(): void {
        throw new Error('transport down');
      },
    };
    const logger = createLogger({ level: 'debug', transport: throwingTransport });

    // When the caller logs.
    // Then the logger swallows the error.
    expect(() => {
      logger.info('still alive');
    }).not.toThrow();
  });
});

describe('resolveLogLevel', () => {
  it('returns the env override when it is a valid level', () => {
    // Given/When/Then: each valid LOG_LEVEL value is returned as-is.
    expect(resolveLogLevel('debug', false)).toBe('debug');
    expect(resolveLogLevel('info', true)).toBe('info');
    expect(resolveLogLevel('warn', true)).toBe('warn');
    expect(resolveLogLevel('error', false)).toBe('error');
  });

  it('falls back to debug in dev and info in prod when the env value is missing', () => {
    // Given/When/Then: undefined uses the dev/prod default.
    expect(resolveLogLevel(undefined, true)).toBe('debug');
    expect(resolveLogLevel(undefined, false)).toBe('info');
  });

  it('falls back silently for invalid env values', () => {
    // Given/When/Then: unknown strings behave like undefined.
    expect(resolveLogLevel('verbose', true)).toBe('debug');
    expect(resolveLogLevel('', false)).toBe('info');
    expect(resolveLogLevel('DEBUG', false)).toBe('info');
  });
});
