/**
 * Lexically normalizes an absolute POSIX path without depending on Node's `path` module.
 *
 * Main and renderer both compare project roots with this function, so it must stay the single
 * definition of "the same directory". It collapses repeated separators, `.` and `..` segments, and
 * drops trailing separators (except for `/` itself). Symlinks and case are deliberately left
 * unresolved: doing so needs filesystem access, and the stored spelling should match what the user
 * registered. Callers must check that the input is absolute first; a relative path would otherwise
 * be silently re-rooted at `/`.
 */
export function normalizeAbsolutePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
