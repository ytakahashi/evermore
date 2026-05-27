import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '../logger';
import { ConsoleTransport } from './console';

function makeRecord(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 'info',
    scope: 'scope',
    message: 'message',
    timestamp: 0,
    ...overrides,
  };
}

describe('ConsoleTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes records to the console method matching their level', () => {
    // Given a transport and spies on every console level method.
    const transport = new ConsoleTransport();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // When the transport writes one record per level.
    transport.write(makeRecord({ level: 'debug', message: 'd' }));
    transport.write(makeRecord({ level: 'info', message: 'i' }));
    transport.write(makeRecord({ level: 'warn', message: 'w' }));
    transport.write(makeRecord({ level: 'error', message: 'e' }));

    // Then each console method receives exactly one prefixed message.
    expect(debugSpy).toHaveBeenCalledExactlyOnceWith('[scope] d');
    expect(infoSpy).toHaveBeenCalledExactlyOnceWith('[scope] i');
    expect(warnSpy).toHaveBeenCalledExactlyOnceWith('[scope] w');
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[scope] e');
  });

  it('omits the prefix when the record has no scope', () => {
    // Given a record without a scope.
    const transport = new ConsoleTransport();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // When the transport writes it.
    transport.write(makeRecord({ scope: '', message: 'bare' }));

    // Then the message is logged with no leading brackets.
    expect(infoSpy).toHaveBeenCalledExactlyOnceWith('bare');
  });

  it('passes meta as a second argument so Error and object inspection survive', () => {
    // Given an error and a record that carries it as meta.
    const transport = new ConsoleTransport();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');

    // When the transport writes the record.
    transport.write(makeRecord({ level: 'error', message: 'failure', meta: err }));

    // Then console.error receives the Error instance verbatim alongside the prefixed message.
    expect(errorSpy).toHaveBeenCalledExactlyOnceWith('[scope] failure', err);
  });

  it('does not pass undefined as a positional argument when meta is omitted', () => {
    // Given a record without meta.
    const transport = new ConsoleTransport();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // When the transport writes it.
    transport.write(makeRecord({ message: 'no-meta' }));

    // Then console.info is called with a single argument (no trailing undefined).
    expect(infoSpy).toHaveBeenCalledExactlyOnceWith('[scope] no-meta');
  });
});
