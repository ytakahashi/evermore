import type { LogRecord, LogTransport } from '../logger';

/**
 * Writes log records to the matching `console[level]` method.
 *
 * `meta` is passed through as the second console argument rather than being JSON-stringified, so
 * `Error` instances keep their stack and structured objects keep their inspectable shape in
 * DevTools or terminal output. Stringification is the responsibility of transports that need a
 * line-oriented format (for example, a future file transport).
 */
export class ConsoleTransport implements LogTransport {
  public write(record: LogRecord): void {
    const prefix = record.scope ? `[${record.scope}] ` : '';
    const text = `${prefix}${record.message}`;

    if (record.meta === undefined) {
      console[record.level](text);
    } else {
      console[record.level](text, record.meta);
    }
  }
}
