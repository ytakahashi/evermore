import { describe, expect, it, vi } from 'vite-plus/test';
import { createTerminalHostRegistry, type TerminalHostHandle } from './terminalHostRegistry';

function handle(): TerminalHostHandle {
  const home = document.createElement('div');
  const element = document.createElement('div');
  home.appendChild(element);
  document.body.appendChild(home);
  return { home, element, fit: vi.fn() };
}

describe('terminal host registry', () => {
  it('moves only the terminal root and returns it once', () => {
    // Given: an owned terminal and a separate display host.
    const registry = createTerminalHostRegistry();
    const terminal = handle();
    const host = document.createElement('div');
    const unregister = registry.register('pane', terminal);
    // When: the root is borrowed.
    const release = registry.borrow('pane', host);

    // Then: the terminal root moves while its home stays in place.
    expect(terminal.element.parentElement).toBe(host);
    expect(registry.getBorrowedHost()).toBe(host);
    expect(terminal.home.parentElement).toBe(document.body);

    // When: the borrower releases twice.
    release?.();
    release?.();
    // Then: ownership is unchanged and each move fits once.
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(registry.getBorrowedHost()).toBeUndefined();
    expect(terminal.fit).toHaveBeenCalledTimes(2);
    unregister();
    terminal.home.remove();
  });

  it('rejects missing terminals and all simultaneous borrows', () => {
    // Given: two registered panes.
    const registry = createTerminalHostRegistry();
    const first = handle();
    const second = handle();
    registry.register('first', first);
    registry.register('second', second);
    const host = document.createElement('div');
    // When: one pane has been borrowed.
    expect(registry.borrow('missing', host)).toBeNull();
    const release = registry.borrow('first', host);
    // Then: borrowing either pane again is forbidden until release.
    expect(registry.borrow('first', host)).toBeNull();
    expect(registry.borrow('second', host)).toBeNull();
    release?.();
    registry.borrow('second', host)?.();
    expect(second.fit).toHaveBeenCalledTimes(2);
    first.home.remove();
    second.home.remove();
  });

  it('does not resurrect an unregistered terminal or disturb a newer borrow', () => {
    // Given: a borrowed terminal that is unregistered before disposal.
    const registry = createTerminalHostRegistry();
    const old = handle();
    const unregister = registry.register('pane', old);
    const oldRelease = registry.borrow('pane', document.createElement('div'));
    unregister();
    old.element.remove();
    const replacement = handle();
    registry.register('pane', replacement);
    const host = document.createElement('div');
    const release = registry.borrow('pane', host);
    // When: stale cleanup runs again.
    unregister();
    oldRelease?.();
    // Then: the replacement remains registered and borrowed.
    expect(old.element.parentElement).toBeNull();
    expect(registry.getHandle('pane')).toBe(replacement);
    expect(replacement.element.parentElement).toBe(host);
    expect(registry.borrow('pane', host)).toBeNull();
    release?.();
    old.home.remove();
    replacement.home.remove();
  });

  it('ignores release when the home was detached', () => {
    // Given: a borrowed terminal whose pane was removed from the DOM.
    const registry = createTerminalHostRegistry();
    const terminal = handle();
    registry.register('pane', terminal);
    const host = document.createElement('div');
    const release = registry.borrow('pane', host);
    terminal.home.remove();
    // When: the borrower releases it.
    release?.();
    // Then: the detached home is not repopulated, and borrowing is unlocked.
    expect(terminal.element.parentElement).toBe(host);
    expect(terminal.fit).toHaveBeenCalledTimes(1);
    expect(registry.getBorrowedHost()).toBeUndefined();
  });

  it('notifies late registration and removal, and isolates replacement cleanup', () => {
    // Given: a subscriber waiting for a terminal.
    const registry = createTerminalHostRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const first = handle();
    const second = handle();
    // When: a registration is replaced and its old cleanup runs.
    const oldCleanup = registry.register('pane', first);
    const cleanup = registry.register('pane', second);
    oldCleanup();
    // Then: only effective changes notify and the replacement survives.
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getHandle('pane')).toBe(second);
    cleanup();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    registry.register('pane', first);
    expect(listener).toHaveBeenCalledTimes(3);
    first.home.remove();
    second.home.remove();
  });

  it('rolls back a borrow when fitting fails and allows a subsequent borrow', () => {
    // Given: a fit callback that observes the host and then fails.
    const registry = createTerminalHostRegistry();
    const terminal = handle();
    const other = handle();
    const host = document.createElement('div');
    const error = new Error('Fit failed');
    let observedHost: HTMLElement | undefined;
    vi.mocked(terminal.fit).mockImplementationOnce(() => {
      observedHost = registry.getBorrowedHost();
      throw error;
    });
    registry.register('pane', terminal);
    registry.register('other', other);

    // When: moving the root succeeds but fitting throws before returning a release function.
    expect(() => registry.borrow('pane', host)).toThrow(error);

    // Then: the in-flight snapshot was consistent, and failure restores the root and unlocks.
    expect(observedHost).toBe(host);
    expect(registry.getBorrowedHost()).toBeUndefined();
    expect(terminal.element.parentElement).toBe(terminal.home);
    const release = registry.borrow('other', host);
    expect(release).not.toBeNull();
    expect(other.element.parentElement).toBe(host);
    release?.();
    terminal.home.remove();
    other.home.remove();
  });

  it('notifies release and unlocks borrowing even if the return fit fails', () => {
    // Given: a borrowed root whose next fit will fail on return.
    const registry = createTerminalHostRegistry();
    const terminal = handle();
    const host = document.createElement('div');
    registry.register('pane', terminal);
    const listener = vi.fn(() => registry.getBorrowedHost());
    registry.subscribe(listener);
    const release = registry.borrow('pane', host);
    const error = new Error('Return fit failed');
    vi.mocked(terminal.fit).mockImplementationOnce(() => {
      throw error;
    });

    // When: release returns the root but fitting throws.
    expect(() => release?.()).toThrow(error);

    // Then: subscribers see the cleared snapshot and a subsequent borrow still works.
    expect(listener).toHaveLastReturnedWith(undefined);
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(registry.getBorrowedHost()).toBeUndefined();
    const nextRelease = registry.borrow('pane', host);
    expect(nextRelease).not.toBeNull();

    // When: the stale release function runs after the new borrow.
    release?.();

    // Then: it cannot affect the new lease.
    expect(terminal.element.parentElement).toBe(host);
    expect(registry.getBorrowedHost()).toBe(host);
    nextRelease?.();
    terminal.home.remove();
  });
});
