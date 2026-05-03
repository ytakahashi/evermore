import { describe, expect, it } from 'vitest';
import { parseOsc7Cwd } from './osc7';

describe('parseOsc7Cwd', () => {
  it('extracts the pathname from a file URL', () => {
    // Given: a shell emits OSC 7 with a regular local cwd URL.

    // When: the payload is parsed.
    const cwd = parseOsc7Cwd('file://hostname/Users/tester/project');

    // Then: the absolute path is returned.
    expect(cwd).toBe('/Users/tester/project');
  });

  it('decodes percent-encoded path segments', () => {
    // Given: a shell emits spaces and non-ASCII characters as URL-encoded bytes.

    // When: the payload is parsed.
    const cwd = parseOsc7Cwd('file://hostname/Users/tester/My%20Project/%E6%A1%9C');

    // Then: the decoded path is returned.
    expect(cwd).toBe('/Users/tester/My Project/桜');
  });

  it('ignores non-file URLs', () => {
    // Given: an OSC 7-like payload uses an unsupported scheme.

    // When: the payload is parsed.
    const cwd = parseOsc7Cwd('https://example.com/Users/tester/project');

    // Then: no cwd update is produced.
    expect(cwd).toBeNull();
  });

  it('ignores malformed URLs and invalid encodings', () => {
    // Given: terminal output contains invalid URL payloads.

    // When: each payload is parsed.

    // Then: malformed values are dropped instead of throwing.
    expect(parseOsc7Cwd('not a url')).toBeNull();
    expect(parseOsc7Cwd('file://hostname/%E0%A4%A')).toBeNull();
  });
});
