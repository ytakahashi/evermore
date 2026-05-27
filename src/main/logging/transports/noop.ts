import type { LogRecord, LogTransport } from '../logger';

/**
 * Discards every log record. Used as the default for tests and as a safe fallback when no
 * real transport has been wired yet.
 */
export class NoopTransport implements LogTransport {
  public write(_record: LogRecord): void {
    // Intentional no-op.
  }
}
