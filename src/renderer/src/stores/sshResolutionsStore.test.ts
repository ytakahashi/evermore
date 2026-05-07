import { describe, it, expect, vi } from 'vitest';
import { createSshResolutionsStore } from './sshResolutionsStore';

describe('sshResolutionsStore', () => {
  it('resolves an alias and updates state to ready', async () => {
    // Given
    const resolvedData = { hostname: ['1.2.3.4'] };
    const sshApi = {
      resolve: vi.fn().mockResolvedValue(resolvedData),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When
    const promise = store.getState().resolveAlias('my-host');

    // Then: status should be loading initially
    expect(store.getState().resolutions['my-host']).toEqual({ status: 'loading' });

    await promise;

    // Then: status should be ready with data
    expect(store.getState().resolutions['my-host']).toEqual({
      status: 'ready',
      data: resolvedData,
    });
    expect(sshApi.resolve).toHaveBeenCalledWith('my-host');
  });

  it('does not re-resolve if already ready', async () => {
    // Given: a resolver call that completes immediately.
    const sshApi = {
      resolve: vi.fn().mockResolvedValue({}),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When: resolveAlias is called twice after the first promise resolves.
    await store.getState().resolveAlias('my-host');
    await store.getState().resolveAlias('my-host');

    // Then: the API is invoked only on the first call.
    expect(sshApi.resolve).toHaveBeenCalledTimes(1);
  });

  it('does not re-resolve if a previous call is still loading', async () => {
    // Given: a resolver call that hangs until manually resolved.
    let resolveExec!: (value: Record<string, string[]>) => void;
    const sshApi = {
      resolve: vi.fn(
        () =>
          new Promise<Record<string, string[]>>((resolve) => {
            resolveExec = resolve;
          }),
      ),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When: a second call is fired before the first resolves.
    void store.getState().resolveAlias('my-host');
    void store.getState().resolveAlias('my-host');

    // Then: the API is invoked only once because the second call hits the loading guard.
    expect(sshApi.resolve).toHaveBeenCalledTimes(1);

    // Cleanup: unblock the in-flight promise so the test does not leave it dangling.
    resolveExec({});
  });

  it('sets error status if resolution fails', async () => {
    // Given
    const sshApi = {
      resolve: vi.fn().mockRejectedValue(new Error('ssh failed')),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When
    await store.getState().resolveAlias('my-host');

    // Then
    expect(store.getState().resolutions['my-host']).toEqual({
      status: 'error',
      error: 'ssh failed',
    });
  });

  it('can retry after an error', async () => {
    // Given
    const sshApi = {
      resolve: vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ hostname: ['ok'] }),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When: first attempt fails
    await store.getState().resolveAlias('my-host');
    expect(store.getState().resolutions['my-host'].status).toBe('error');

    // When: second attempt succeeds
    await store.getState().resolveAlias('my-host');

    // Then
    expect(store.getState().resolutions['my-host']).toEqual({
      status: 'ready',
      data: { hostname: ['ok'] },
    });
    expect(sshApi.resolve).toHaveBeenCalledTimes(2);
  });

  it('clears all resolutions', async () => {
    // Given
    const sshApi = {
      resolve: vi.fn().mockResolvedValue({}),
    };
    const store = createSshResolutionsStore({ sshApi });
    await store.getState().resolveAlias('a');
    await store.getState().resolveAlias('b');

    // When
    store.getState().clear();

    // Then
    expect(store.getState().resolutions).toEqual({});
  });

  it('does not restore an in-flight result after clear', async () => {
    // Given: a resolution request is still running when the cache is cleared.
    let resolveFirst!: (value: Record<string, string[]>) => void;
    const sshApi = {
      resolve: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Record<string, string[]>>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValueOnce({ hostname: ['fresh'] }),
    };
    const store = createSshResolutionsStore({ sshApi });

    // When: clear runs before the first request completes.
    const stalePromise = store.getState().resolveAlias('my-host');
    store.getState().clear();
    resolveFirst({ hostname: ['stale'] });
    await stalePromise;

    // Then: the late result is ignored instead of repopulating cleared state.
    expect(store.getState().resolutions).toEqual({});

    // When: the alias is resolved again after invalidation.
    await store.getState().resolveAlias('my-host');

    // Then: a fresh API result is stored.
    expect(store.getState().resolutions['my-host']).toEqual({
      status: 'ready',
      data: { hostname: ['fresh'] },
    });
    expect(sshApi.resolve).toHaveBeenCalledTimes(2);
  });
});
