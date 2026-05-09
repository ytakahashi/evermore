export interface PathBasenameOptions {
  emptyFallback?: string;
  rootFallback?: string;
}

export interface TruncatedPathLabelOptions {
  ellipsis?: string;
  emptyFallback?: string;
  maxSegments?: number;
}

function getPathSegments(path: string): { isAbsolute: boolean; segments: string[] } {
  const normalizedPath = path.replace(/\/+$/, '');
  return {
    isAbsolute: normalizedPath.startsWith('/'),
    segments: normalizedPath.split('/').filter(Boolean),
  };
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

  const basename = getPathSegments(trimmedPath).segments.at(-1);
  return basename || emptyFallback;
}

/**
 * Returns a shortened POSIX-style path that preserves the trailing path segments.
 *
 * This mirrors `getPathBasename` by keeping the helper runtime-neutral and by treating tilde paths
 * as plain path segments instead of expanding them to a home directory.
 */
export function getTruncatedPathLabel(
  path: string,
  options: TruncatedPathLabelOptions = {},
): string {
  const ellipsis = options.ellipsis ?? '...';
  const emptyFallback = options.emptyFallback ?? '';
  const maxSegments = Math.max(1, options.maxSegments ?? 2);
  const trimmedPath = path.trim();

  if (!trimmedPath) {
    return emptyFallback;
  }

  if (trimmedPath === '/') {
    return '/';
  }

  const { isAbsolute, segments } = getPathSegments(trimmedPath);
  if (segments.length === 0) {
    return emptyFallback;
  }

  if (segments.length <= maxSegments) {
    const label = segments.join('/');
    return isAbsolute ? `/${label}` : label;
  }

  return `${ellipsis}/${segments.slice(-maxSegments).join('/')}`;
}
