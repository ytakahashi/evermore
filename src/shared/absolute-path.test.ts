import { describe, expect, it } from 'vite-plus/test';
import { normalizeAbsolutePath } from './absolute-path';

describe('normalizeAbsolutePath', () => {
  it('collapses redundant segments and trailing separators', () => {
    // Given: absolute paths with repeated separators, dot segments, and trailing slashes.

    // When / Then: equivalent spellings share one normalized form.
    expect(normalizeAbsolutePath('/a//b/.././c/')).toBe('/a/c');
    expect(normalizeAbsolutePath('/a/b/')).toBe('/a/b');
    expect(normalizeAbsolutePath('/a/./b')).toBe('/a/b');
  });

  it('keeps the root directory and clamps traversal above it', () => {
    // Given: the root directory and paths that traverse past it.

    // When / Then: the result never escapes `/`.
    expect(normalizeAbsolutePath('/')).toBe('/');
    expect(normalizeAbsolutePath('/../../')).toBe('/');
  });

  it('does not resolve case or symlink spellings', () => {
    // Given: paths that may refer to the same directory on a case-insensitive filesystem.

    // When / Then: they stay distinct because normalization is purely lexical.
    expect(normalizeAbsolutePath('/A')).not.toBe(normalizeAbsolutePath('/a'));
  });
});
