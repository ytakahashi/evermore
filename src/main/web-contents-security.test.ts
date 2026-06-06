import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachWebContentsNavigationGuard,
  openSafeExternalUrl,
  registerSecurityHandlers,
} from './web-contents-security';

const shellMock = vi.hoisted(() => ({
  openExternal: vi.fn(() => Promise.resolve()),
}));

const sessionMock = vi.hoisted(() => ({
  defaultSession: {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  },
}));

const appMock = vi.hoisted(() => ({
  on: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: shellMock,
  session: sessionMock,
  app: appMock,
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

  function captureListener(options?: { allowedInternalOrigins?: string[] }): {
    invoke: NavigateListener;
  } {
    let listener: NavigateListener | null = null;
    const fakeWebContents = {
      on: vi.fn((channel: string, handler: NavigateListener) => {
        if (channel === 'will-navigate') {
          listener = handler;
        }
      }),
    } as unknown as WebContents;

    attachWebContentsNavigationGuard(fakeWebContents, options);

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

  it('allows navigation inside an explicitly trusted app origin', () => {
    // Given: a guard configured for the Vite dev server origin.
    const harness = captureListener({
      allowedInternalOrigins: ['http://localhost:5173/index.html'],
    });
    const preventDefault = vi.fn();

    // When: the app loads or refreshes inside the same dev server origin.
    harness.invoke({ preventDefault }, 'http://localhost:5173/settings');

    // Then: the in-window navigation is allowed and nothing is opened externally.
    expect(preventDefault).not.toHaveBeenCalled();
    expect(shellMock.openExternal).not.toHaveBeenCalled();
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

describe('registerSecurityHandlers', () => {
  type WebviewAttachListener = (event: { preventDefault: () => void }) => void;
  type WebContentsCreatedListener = (event: unknown, webContents: WebContents) => void;
  type WebContentsOn = (channel: 'will-attach-webview', handler: WebviewAttachListener) => void;

  beforeEach(() => {
    sessionMock.defaultSession.setPermissionRequestHandler.mockClear();
    sessionMock.defaultSession.setPermissionCheckHandler.mockClear();
    appMock.on.mockClear();
  });

  it('sets the permission request handler to deny all permissions', () => {
    // Given: nothing.

    // When: handlers are registered.
    registerSecurityHandlers();

    // Then: the default session registers a permission handler.
    expect(sessionMock.defaultSession.setPermissionRequestHandler).toHaveBeenCalledTimes(1);

    // And: when the handler is invoked, it calls the callback with false (denied).
    const handler = sessionMock.defaultSession.setPermissionRequestHandler.mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    const callback = vi.fn();
    handler({} as WebContents, 'geolocation', callback);
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('sets the permission check handler to deny synchronous permission lookups', () => {
    // Given: nothing.

    // When: handlers are registered.
    registerSecurityHandlers();

    // Then: the default session registers a check handler that returns false.
    expect(sessionMock.defaultSession.setPermissionCheckHandler).toHaveBeenCalledTimes(1);
    const handler = sessionMock.defaultSession.setPermissionCheckHandler.mock.calls[0]?.[0];
    expect(handler).toBeDefined();
    expect(handler(null, 'geolocation', 'https://example.com', { embeddingOrigin: '' })).toBe(
      false,
    );
  });

  it('registers a web-contents-created listener that prevents webview attachment', () => {
    // Given: nothing.

    // When: handlers are registered.
    registerSecurityHandlers();

    // Then: app registers a listener for web-contents-created.
    expect(appMock.on).toHaveBeenCalledWith('web-contents-created', expect.any(Function));

    // And: when web-contents-created fires, it attaches a will-attach-webview listener.
    const onCreate = appMock.on.mock.calls.find(
      (call) => call[0] === 'web-contents-created',
    )?.[1] as WebContentsCreatedListener | undefined;
    if (!onCreate) {
      throw new Error('web-contents-created listener was not registered');
    }

    const webContentsOn = vi.fn<WebContentsOn>();
    const fakeWebContents = {
      on: webContentsOn,
    } as unknown as WebContents;

    onCreate({}, fakeWebContents);

    expect(webContentsOn).toHaveBeenCalledWith('will-attach-webview', expect.any(Function));

    // And: when will-attach-webview fires, it prevents the default behavior.
    const onAttachWebview = webContentsOn.mock.calls.find(
      ([channel]) => channel === 'will-attach-webview',
    )?.[1];
    if (!onAttachWebview) {
      throw new Error('will-attach-webview listener was not registered');
    }

    const preventDefault = vi.fn();
    onAttachWebview({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
