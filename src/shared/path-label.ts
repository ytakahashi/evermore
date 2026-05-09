export interface PathBasenameOptions {
  emptyFallback?: string;
  rootFallback?: string;
}

/**
 * Returns a display basename for a POSIX-style path without depending on Node's `path` module.
 *
 * Callers are expected to pass an absolute path (e.g. cwd reported via OSC 7) or an empty string.
 * `~` alone is preserved as a useful label, but tilde-prefixed paths like `~/foo/bar` are not
 * expanded; they will be treated as relative segments and only the last segment is returned.
 * If a future caller needs to display unexpanded tilde paths verbatim, expand them upstream first.
 */
export function getPathBasename(path: string, options: PathBasenameOptions = {}): string {
  const emptyFallback = options.emptyFallback ?? '';
  const rootFallback = options.rootFallback ?? '/';
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return emptyFallback;
  }

  if (trimmedPath === '~') {
    return '~';
  }

  if (trimmedPath === '/') {
    return rootFallback;
  }

  const basename = trimmedPath.replace(/\/+$/, '').split('/').filter(Boolean).at(-1);
  return basename || emptyFallback;
}
