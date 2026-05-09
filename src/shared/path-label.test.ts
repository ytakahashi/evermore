import { describe, expect, it } from 'vitest';
import { getPathBasename, getTruncatedPathLabel } from './path-label';

describe('getPathBasename', () => {
  it('returns the final path segment for POSIX-style paths', () => {
    // Given: absolute paths with and without trailing slashes.

    // When / Then: callers receive the display basename.
    expect(getPathBasename('/Users/tester/project')).toBe('project');
    expect(getPathBasename('/Users/tester/project/')).toBe('project');
  });

  it('uses explicit fallbacks for empty and root paths', () => {
    // Given: callers need context-specific labels for non-file paths.

    // When / Then: empty and root values are mapped through the provided options.
    expect(getPathBasename('', { emptyFallback: '(loading)' })).toBe('(loading)');
    expect(getPathBasename('/', { rootFallback: 'Tab' })).toBe('Tab');
  });

  it('preserves the home shorthand as a useful label', () => {
    // Given: a shell reports the home shorthand.

    // When / Then: the shorthand is returned unchanged.
    expect(getPathBasename('~', { emptyFallback: 'Tab', rootFallback: 'Tab' })).toBe('~');
  });
});

describe('getTruncatedPathLabel', () => {
  it('preserves short absolute paths without adding an ellipsis', () => {
    // Given: absolute paths at or under the default segment limit.

    // When / Then: callers receive the path without truncation.
    expect(getTruncatedPathLabel('/')).toBe('/');
    expect(getTruncatedPathLabel('/Users')).toBe('/Users');
    expect(getTruncatedPathLabel('/Users/tester')).toBe('/Users/tester');
  });

  it('collapses long absolute paths to the final two segments by default', () => {
    // Given: an absolute cwd with more than two path segments.

    // When / Then: the leading path is represented by a single ellipsis.
    expect(getTruncatedPathLabel('/Users/tester/ghq/github.com/tester/evermore')).toBe(
      '.../tester/evermore',
    );
    expect(getTruncatedPathLabel('/Users/tester/project/')).toBe('.../tester/project');
  });

  it('uses the empty fallback for blank input', () => {
    // Given: a path has not been reported yet.

    // When / Then: callers can provide a context-specific loading label.
    expect(getTruncatedPathLabel('', { emptyFallback: '(loading)' })).toBe('(loading)');
    expect(getTruncatedPathLabel('   ', { emptyFallback: '(loading)' })).toBe('(loading)');
  });

  it('treats tilde paths as plain segments instead of expanding them', () => {
    // Given: callers pass shell-style tilde paths.

    // When / Then: the helper keeps the path textual and never expands the home directory.
    expect(getTruncatedPathLabel('~')).toBe('~');
    expect(getTruncatedPathLabel('~/foo')).toBe('~/foo');
    expect(getTruncatedPathLabel('~/foo/bar')).toBe('.../foo/bar');
  });

  it('honors custom segment counts and ellipsis text', () => {
    // Given: callers need a different amount of retained context.

    // When / Then: the trailing segment count and marker are configurable.
    expect(getTruncatedPathLabel('/Users/tester/project', { maxSegments: 1 })).toBe('.../project');
    expect(getTruncatedPathLabel('/Users/tester/project', { maxSegments: 3 })).toBe(
      '/Users/tester/project',
    );
    expect(getTruncatedPathLabel('/Users/tester/project/src', { ellipsis: '..' })).toBe(
      '../project/src',
    );
  });
});
