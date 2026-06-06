import { app, session, shell, type WebContents } from 'electron';

/**
 * Registers global security handlers on the Electron application, such as denying permission
 * requests and preventing webview attachments.
 *
 * This should be called after Electron has finished initialization (i.e. in app.whenReady).
 */
export function registerSecurityHandlers(): void {
  // Deny all permission requests on the default session. This covers async prompts triggered by
  // APIs like getUserMedia or Notification.requestPermission.
  session.defaultSession.setPermissionRequestHandler(
    (
      _webContents: WebContents,
      _permission: string,
      callback: (allowed: boolean) => void,
    ): void => {
      callback(false);
    },
  );

  // Deny synchronous permission lookups (navigator.permissions.query, Notification.permission)
  // for the same scope. Without this, the request handler above can be bypassed for APIs that
  // only consult the check path.
  session.defaultSession.setPermissionCheckHandler((): boolean => false);

  // Prevent <webview> tag attachments across all web contents
  app.on('web-contents-created', (_event: unknown, webContents: WebContents): void => {
    webContents.on('will-attach-webview', (event: { preventDefault: () => void }): void => {
      event.preventDefault();
    });
  });
}

/**
 * Protocols that may be forwarded to the OS via `shell.openExternal`. Anything outside this list
 * (`file:`, `javascript:`, custom URL schemes) is dropped so a compromised or buggy renderer
 * cannot drive the desktop into opening arbitrary handlers.
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

interface AttachWebContentsNavigationGuardOptions {
  /**
   * Origins that are allowed to stay inside this WebContents. This is mainly for the Vite dev
   * server: Electron's initial `loadURL()` and full-page dev refreshes can surface as
   * `will-navigate`, but they are still the trusted app shell.
   */
  allowedInternalOrigins?: string[];
}

/**
 * Hands an http(s) URL to the OS browser, ignoring anything else.
 *
 * This is the safe sink for URLs that originate in the renderer or in untrusted page content
 * (e.g. links the user clicked inside the renderer, `window.open` targets). Malformed URLs and
 * non-allowlisted schemes are silently discarded rather than thrown so that callers can wire it
 * into Electron event handlers without try/catch.
 */
export function openSafeExternalUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (_error: unknown) {
    // Malformed URLs from page navigation events are ignored: there is nothing safe to open and
    // surfacing the error would only be noise during normal browsing.
    return;
  }

  if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    void shell.openExternal(parsed.toString());
  }
}

function parseOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch (_error: unknown) {
    // Invalid allowlist entries cannot match a navigation target, so they are ignored.
    return null;
  }
}

function isAllowedInternalNavigation(rawUrl: string, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = parseOrigin(rawUrl);
  return origin !== null && allowedOrigins.has(origin);
}

/**
 * Blocks in-window top-level navigation and re-routes safe URLs to the system browser.
 *
 * The renderer is a single-page React app: any `will-navigate` event (anchor click without
 * `target=_blank`, `location.href` assignment, meta refresh) is either a bug or hostile content
 * trying to leave the trusted bundle. The one exception is an explicitly allowlisted internal
 * origin, used for the Vite dev server so startup and full-page refreshes can complete. For plain
 * http(s) URLs we still surface the destination via the OS browser so the user is not left
 * wondering why the link "did nothing".
 */
export function attachWebContentsNavigationGuard(
  webContents: WebContents,
  options: AttachWebContentsNavigationGuardOptions = {},
): void {
  const allowedInternalOrigins = new Set(
    (options.allowedInternalOrigins ?? []).map(parseOrigin).filter((origin) => origin !== null),
  );

  webContents.on('will-navigate', (event, url) => {
    if (isAllowedInternalNavigation(url, allowedInternalOrigins)) {
      return;
    }

    event.preventDefault();
    openSafeExternalUrl(url);
  });
}
