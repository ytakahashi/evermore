/**
 * Extracts an absolute cwd path from an OSC 7 file URL payload.
 */
export function parseOsc7Cwd(data: string): string | null {
  try {
    const url = new URL(data);
    if (url.protocol !== 'file:') {
      return null;
    }

    const cwd = decodeURIComponent(url.pathname);
    return cwd.startsWith('/') ? cwd : null;
  } catch (_error: unknown) {
    // Shells can emit malformed or partially encoded OSC payloads; invalid cwd reports should not
    // affect terminal output or pane lifecycle.
    return null;
  }
}
