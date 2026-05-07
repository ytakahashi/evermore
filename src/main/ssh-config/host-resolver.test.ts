import { describe, it, expect, vi } from 'vitest';
import { SshHostResolver, parseSshGOutput } from './host-resolver';

describe('parseSshGOutput', () => {
  it('parses typical ssh -G output', () => {
    // Given
    const stdout = `
user yt
hostname dev.example.com
port 22
identityfile ~/.ssh/id_ed25519
identityfile ~/.ssh/id_rsa
forwardagent yes
`;

    // When
    const result = parseSshGOutput(stdout);

    // Then
    expect(result['user']).toEqual(['yt']);
    expect(result['hostname']).toEqual(['dev.example.com']);
    expect(result['port']).toEqual(['22']);
    expect(result['identityfile']).toEqual(['~/.ssh/id_ed25519', '~/.ssh/id_rsa']);
    expect(result['forwardagent']).toEqual(['yes']);
  });

  it('handles empty input and extra spaces', () => {
    // Given
    const stdout = '   \n  \n  hostname    myhost   \n';

    // When
    const result = parseSshGOutput(stdout);

    // Then
    expect(result['hostname']).toEqual(['myhost']);
    expect(Object.keys(result)).toHaveLength(1);
  });

  it('normalizes keys to lowercase', () => {
    // Given
    const stdout = 'HostName example.com\nUSER root';

    // When
    const result = parseSshGOutput(stdout);

    // Then
    expect(result['hostname']).toEqual(['example.com']);
    expect(result['user']).toEqual(['root']);
  });

  it('handles directives with empty values', () => {
    // Given
    const stdout = 'ForwardAgent\nVisualHostKey yes';

    // When
    const result = parseSshGOutput(stdout);

    // Then
    // Currently the implementation joins valueParts (which is empty) into an empty string.
    expect(result['forwardagent']).toEqual(['']);
    expect(result['visualhostkey']).toEqual(['yes']);
  });
});

describe('SshHostResolver', () => {
  it('resolves alias and caches the result', async () => {
    // Given
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'hostname 1.2.3.4\nuser admin',
      stderr: '',
    });
    const resolver = new SshHostResolver({ execFile });

    // When: First call
    const result1 = await resolver.resolve('my-alias');

    // Then
    expect(result1['hostname']).toEqual(['1.2.3.4']);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith('ssh', ['-G', 'my-alias']);

    // When: Second call (should be cached)
    const result2 = await resolver.resolve('my-alias');

    // Then
    expect(result2).toBe(result1);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('handles different aliases separately', async () => {
    // Given
    const execFile = vi.fn().mockResolvedValue({ stdout: 'hostname host', stderr: '' });
    const resolver = new SshHostResolver({ execFile });

    // When
    await resolver.resolve('a');
    await resolver.resolve('b');

    // Then
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('clears cache', async () => {
    // Given
    const execFile = vi.fn().mockResolvedValue({ stdout: 'hostname host', stderr: '' });
    const resolver = new SshHostResolver({ execFile });

    // When
    await resolver.resolve('a');
    resolver.clear();
    await resolver.resolve('a');

    // Then
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('does not cache an in-flight result that completes after clear', async () => {
    // Given: the first ssh -G call is still running when the cache is cleared.
    let resolveFirst!: (value: { stdout: string; stderr: string }) => void;
    const execFile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ stdout: string; stderr: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ stdout: 'hostname fresh', stderr: '' });
    const resolver = new SshHostResolver({ execFile });

    // When: clear runs before the first call completes.
    const stalePromise = resolver.resolve('a');
    resolver.clear();
    resolveFirst({ stdout: 'hostname stale', stderr: '' });
    const staleResult = await stalePromise;

    // Then: the in-flight caller still receives its result, but it is not cached.
    expect(staleResult['hostname']).toEqual(['stale']);

    // When: the alias is resolved again after invalidation.
    const freshResult = await resolver.resolve('a');

    // Then: a new subprocess result is used instead of the stale late result.
    expect(freshResult['hostname']).toEqual(['fresh']);
    expect(execFile).toHaveBeenCalledTimes(2);
  });

  it('does not cache if execFile fails', async () => {
    // Given
    const execFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('ssh failed'))
      .mockResolvedValueOnce({ stdout: 'hostname success', stderr: '' });
    const resolver = new SshHostResolver({ execFile });

    // When & Then: First call fails
    await expect(resolver.resolve('a')).rejects.toThrow('ssh failed');
    expect(execFile).toHaveBeenCalledTimes(1);

    // When: Second call succeeds
    const result = await resolver.resolve('a');

    // Then
    expect(result['hostname']).toEqual(['success']);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
