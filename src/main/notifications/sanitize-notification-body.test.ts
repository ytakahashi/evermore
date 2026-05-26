import { describe, expect, it } from 'vitest';
import { sanitizeNotificationBody } from './sanitize-notification-body';

// Build control characters at runtime via String.fromCharCode so the source file stays plain
// ASCII on disk. Embedding the raw 0x1B / 0x07 / 0x00 bytes directly makes editors and code
// review tools refuse to display the file.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NUL = String.fromCharCode(0x00);

describe('sanitizeNotificationBody', () => {
  it('returns the empty string for undefined / empty input', () => {
    // Given / When / Then.
    expect(sanitizeNotificationBody(undefined)).toBe('');
    expect(sanitizeNotificationBody('')).toBe('');
  });

  it('strips ANSI CSI color sequences and OSC title sequences from agent output', () => {
    // Given: an agent message decorated with color escapes and an OSC title sequence.
    const input = `${ESC}[31mHello${ESC}[0m ${ESC}]0;title${BEL}there`;

    // When: sanitized.
    const result = sanitizeNotificationBody(input);

    // Then: only the plain text survives, with whitespace runs collapsed.
    expect(result).toBe('Hello there');
  });

  it('removes ASCII control characters but keeps tabs and newlines as whitespace', () => {
    // Given: a message containing NUL / BEL alongside whitespace control characters.
    const input = `a${NUL}b${BEL} c\td\ne`;

    // When: sanitized.
    const result = sanitizeNotificationBody(input);

    // Then: control characters are dropped and the surviving whitespace is collapsed to spaces.
    expect(result).toBe('ab c d e');
  });

  it('collapses repeated whitespace and trims edges', () => {
    // Given: a message padded with runs of whitespace.
    const input = '   line one\r\nline    two\t\t  ';

    // When: sanitized.
    const result = sanitizeNotificationBody(input);

    // Then: whitespace runs collapse to a single space and the result is trimmed.
    expect(result).toBe('line one line two');
  });

  it('returns "" when sanitization removes everything', () => {
    // Given: input that consists entirely of escape sequences and control characters.
    const input = `${ESC}[2J${ESC}[H  `;

    // When: sanitized.
    const result = sanitizeNotificationBody(input);

    // Then: nothing remains for the body, so the caller can apply a fallback.
    expect(result).toBe('');
  });

  it('truncates long inputs at the configured code-point boundary and appends an ellipsis', () => {
    // Given: a message far longer than the requested limit.
    const input = 'x'.repeat(20);

    // When: truncated to 5 characters.
    const result = sanitizeNotificationBody(input, 5);

    // Then: the result is exactly the limit plus an ellipsis marker.
    expect(result).toBe('xxxxx…');
  });

  it('keeps surrogate pairs intact when truncating', () => {
    // Given: a message of astral-plane characters that occupy two UTF-16 code units each.
    const input = '😀😀😀😀😀😀';

    // When: truncated to four code points.
    const result = sanitizeNotificationBody(input, 4);

    // Then: the truncation respects code-point boundaries instead of slicing a surrogate pair.
    expect(result).toBe('😀😀😀😀…');
  });
});
