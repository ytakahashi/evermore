import type { LogRecord, LogTransport } from '../logger';

/**
 * Fans out a single log record to multiple transports.
 *
 * Per-transport failures are isolated: a throw from one `write` or `dispose` call must not stop
 * the others from running. Used by the composition root to combine, for example, a console
 * transport with a future file transport.
 */
export class MultiTransport implements LogTransport {
  private readonly transports: readonly LogTransport[];

  public constructor(transports: readonly LogTransport[]) {
    // Snapshot the input so later mutations by the caller cannot alter this instance's fan-out.
    // The `readonly` parameter type is a compile-time contract only.
    this.transports = [...transports];
  }

  public write(record: LogRecord): void {
    for (const transport of this.transports) {
      try {
        transport.write(record);
      } catch (_error: unknown) {
        // Swallow per-transport failures so one broken sink cannot suppress the others.
      }
    }
  }

  public dispose(): void {
    for (const transport of this.transports) {
      try {
        transport.dispose?.();
      } catch (_error: unknown) {
        // dispose() is best-effort during shutdown; ignore failures and keep cleaning up.
      }
    }
  }
}
