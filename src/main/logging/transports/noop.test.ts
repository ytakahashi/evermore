import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '../logger';
import { NoopTransport } from './noop';

describe('NoopTransport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call any console method when records are written', () => {
    // Given a noop transport and spies on every console level method.
    const transport = new NoopTransport();
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // When records are written at every level.
    const levels: LogRecord['level'][] = ['debug', 'info', 'warn', 'error'];
    for (const level of levels) {
      transport.write({ level, scope: 's', message: 'm', timestamp: 0 });
    }

    // Then no console method is touched.
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is safe to write to without throwing', () => {
    // Given a noop transport.
    const transport = new NoopTransport();

    // When records are written.
    // Then nothing throws.
    expect(() => {
      transport.write({ level: 'info', scope: '', message: '', timestamp: 0 });
    }).not.toThrow();
  });
});
