import { describe, expect, it } from 'vitest';
import { assertIpcRequestAllowed } from './authorization';

describe('assertIpcRequestAllowed', () => {
  it('does nothing when a request is allowed', () => {
    // Given / When / Then: allowed requests continue without throwing.
    expect(() => assertIpcRequestAllowed('ssh:resolve', true)).not.toThrow();
  });

  it('throws a fixed message without echoing renderer values when a request is not allowed', () => {
    // Given: an arbitrary renderer-controlled alias that must not appear in the error.
    const arbitraryAlias = 'renderer-controlled-alias';

    // When: authorization rejects the request.
    let error: unknown;
    try {
      assertIpcRequestAllowed('ssh:resolve', false);
    } catch (caughtError: unknown) {
      error = caughtError;
    }

    // Then: authorization failures name only the channel.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('IPC request is not allowed for ssh:resolve');
    expect((error as Error).message).not.toContain(arbitraryAlias);
  });
});
