import { describe, expect, it } from 'vitest';
import { getPathBasename } from './path-label';

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
