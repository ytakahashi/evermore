import { describe, expect, it, vi } from 'vitest';
import type { LogRecord, LogTransport } from '../logger';
import { MultiTransport } from './multi';

function makeRecord(): LogRecord {
  return { level: 'info', scope: 's', message: 'm', timestamp: 0 };
}

describe('MultiTransport', () => {
  it('fans every record out to all child transports', () => {
    // Given two recording transports wrapped in a MultiTransport.
    const writeA = vi.fn();
    const writeB = vi.fn();
    const multi = new MultiTransport([{ write: writeA }, { write: writeB }]);
    const record = makeRecord();

    // When a record is written.
    multi.write(record);

    // Then both transports receive the same record.
    expect(writeA).toHaveBeenCalledExactlyOnceWith(record);
    expect(writeB).toHaveBeenCalledExactlyOnceWith(record);
  });

  it('keeps delivering to other transports when one throws', () => {
    // Given a transport that throws sandwiched between two healthy ones.
    const writeA = vi.fn();
    const writeC = vi.fn();
    const throwing: LogTransport = {
      write(): void {
        throw new Error('down');
      },
    };
    const multi = new MultiTransport([{ write: writeA }, throwing, { write: writeC }]);

    // When a record is written.
    // Then the call does not throw and the healthy transports both receive the record.
    expect(() => {
      multi.write(makeRecord());
    }).not.toThrow();
    expect(writeA).toHaveBeenCalledOnce();
    expect(writeC).toHaveBeenCalledOnce();
  });

  it('disposes every transport that exposes dispose, even if one throws', () => {
    // Given three transports where the middle one throws on dispose.
    const disposeA = vi.fn();
    const disposeC = vi.fn();
    const multi = new MultiTransport([
      { write: vi.fn(), dispose: disposeA },
      {
        write: vi.fn(),
        dispose: () => {
          throw new Error('dispose failed');
        },
      },
      { write: vi.fn(), dispose: disposeC },
    ]);

    // When the multi transport is disposed.
    // Then dispose is called on the healthy transports and no error escapes.
    expect(() => {
      multi.dispose();
    }).not.toThrow();
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeC).toHaveBeenCalledOnce();
  });

  it('tolerates transports that omit dispose', () => {
    // Given a transport without a dispose method.
    const multi = new MultiTransport([{ write: vi.fn() }]);

    // When the multi transport is disposed.
    // Then nothing throws.
    expect(() => {
      multi.dispose();
    }).not.toThrow();
  });
});
