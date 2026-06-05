import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachWebContentsNavigationGuard, openSafeExternalUrl } from './web-contents-security';

const shellMock = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
}));

vi.mock('electron', () => ({
  shell: shellMock,
}));

describe('openSafeExternalUrl', () => {
  beforeEach(() => {
    shellMock.openExternal.mockClear();
  });

  it('forwards https URLs to shell.openExternal', () => {
    // Given: an https URL coming from a renderer link click.
    const url = 'https://example.com/path?query=1';

    // When: the helper is invoked.
    openSafeExternalUrl(url);

    // Then: the OS browser is asked to open the same URL.
    expect(shellMock.openExternal).toHaveBeenCalledTimes(1);
    expect(shellMock.openExternal).toHaveBeenCalledWith(url);
  });

  it('forwards http URLs to shell.openExternal', () => {
    // Given: a plain http URL (still useful for local servers).
    const url = 'http://localhost:3000/';

    // When: the helper is invoked.
    openSafeExternalUrl(url);

    // Then: it is forwarded to the OS browser.
    expect(shellMock.openExternal).toHaveBeenCalledWith(url);
  });

  it.each([
    ['file://', 'file:///etc/passwd'],
    ['javascript:', 'javascript:alert(1)'],
    ['custom scheme', 'evermore://hijack'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['ftp:', 'ftp://example.com/'],
  ])('drops non-allowlisted scheme (%s)', (_label, url) => {
    // Given: a URL with a scheme outside the http(s) allowlist.
    // When: the helper is invoked.
    openSafeExternalUrl(url);

    // Then: nothing is handed to the OS.
    expect(shellMock.openExternal).not.toHaveBeenCalled();
  });

  it('ignores malformed URLs without throwing', () => {
    // Given: a string that does not parse as a URL.
    // When/Then: invocation is silent.
    expect(() => {
      openSafeExternalUrl('not a url');
    }).not.toThrow();
    expect(shellMock.openExternal).not.toHaveBeenCalled();
  });
});

describe('attachWebContentsNavigationGuard', () => {
  beforeEach(() => {
    shellMock.openExternal.mockClear();
  });

  type NavigateListener = (event: { preventDefault: () => void }, url: string) => void;

  function captureListener(): { invoke: NavigateListener } {
    let listener: NavigateListener | null = null;
    const fakeWebContents = {
      on: vi.fn((channel: string, handler: NavigateListener) => {
        if (channel === 'will-navigate') {
          listener = handler;
        }
      }),
    } as unknown as WebContents;

    attachWebContentsNavigationGuard(fakeWebContents);

    return {
      invoke: (event, url) => {
        if (!listener) {
          throw new Error('will-navigate listener was not registered');
        }
        listener(event, url);
      },
    };
  }

  it('cancels navigation and surfaces safe URLs externally', () => {
    // Given: a guard attached to a fake WebContents.
    const harness = captureListener();
    const preventDefault = vi.fn();

    // When: a will-navigate event fires with an https target.
    harness.invoke({ preventDefault }, 'https://example.com/');

    // Then: navigation is cancelled and the URL is opened in the system browser.
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(shellMock.openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('cancels navigation without opening anything for hostile schemes', () => {
    // Given: a guard attached to a fake WebContents.
    const harness = captureListener();
    const preventDefault = vi.fn();

    // When: a will-navigate event fires with a file:// URL.
    harness.invoke({ preventDefault }, 'file:///etc/passwd');

    // Then: navigation is still cancelled, but nothing leaves the app.
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(shellMock.openExternal).not.toHaveBeenCalled();
  });
});
