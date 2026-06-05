import { shell, type WebContents } from 'electron';

/**
 * Protocols that may be forwarded to the OS via `shell.openExternal`. Anything outside this list
 * (`file:`, `javascript:`, custom URL schemes) is dropped so a compromised or buggy renderer
 * cannot drive the desktop into opening arbitrary handlers.
 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:']);

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

/**
 * Blocks in-window top-level navigation and re-routes safe URLs to the system browser.
 *
 * The renderer is a single-page React app: any `will-navigate` event (anchor click without
 * `target=_blank`, `location.href` assignment, meta refresh) is either a bug or hostile content
 * trying to leave the trusted bundle. We always prevent the navigation; for plain http(s) URLs we
 * still surface the destination via the OS browser so the user is not left wondering why the
 * link "did nothing".
 */
export function attachWebContentsNavigationGuard(webContents: WebContents): void {
  webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openSafeExternalUrl(url);
  });
}
