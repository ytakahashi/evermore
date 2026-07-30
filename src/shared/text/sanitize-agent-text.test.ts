import { describe, expect, it } from 'vitest';
import { sanitizeAgentText, sanitizeUserPromptText } from './sanitize-agent-text';

// Build control characters at runtime via String.fromCharCode so the source file stays plain
// ASCII on disk. Embedding the raw 0x1B / 0x07 / 0x00 bytes directly makes editors and code
// review tools refuse to display the file.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const NUL = String.fromCharCode(0x00);

describe('sanitizeAgentText', () => {
  it('returns the empty string for undefined / empty input', () => {
    // Given / When / Then.
    expect(sanitizeAgentText(undefined)).toBe('');
    expect(sanitizeAgentText('')).toBe('');
  });

  it('strips ANSI CSI color sequences and OSC title sequences from agent output', () => {
    // Given: an agent message decorated with color escapes and an OSC title sequence.
    const input = `${ESC}[31mHello${ESC}[0m ${ESC}]0;title${BEL}there`;

    // When: sanitized.
    const result = sanitizeAgentText(input);

    // Then: only the plain text survives, with whitespace runs collapsed.
    expect(result).toBe('Hello there');
  });

  it('removes ASCII control characters but keeps tabs and newlines as whitespace', () => {
    // Given: a message containing NUL / BEL alongside whitespace control characters.
    const input = `a${NUL}b${BEL} c\td\ne`;

    // When: sanitized.
    const result = sanitizeAgentText(input);

    // Then: control characters are dropped and the surviving whitespace is collapsed to spaces.
    expect(result).toBe('ab c d e');
  });

  it('collapses repeated whitespace and trims edges', () => {
    // Given: a message padded with runs of whitespace.
    const input = '   line one\r\nline    two\t\t  ';

    // When: sanitized.
    const result = sanitizeAgentText(input);

    // Then: whitespace runs collapse to a single space and the result is trimmed.
    expect(result).toBe('line one line two');
  });

  it('returns "" when sanitization removes everything', () => {
    // Given: input that consists entirely of escape sequences and control characters.
    const input = `${ESC}[2J${ESC}[H  `;

    // When: sanitized.
    const result = sanitizeAgentText(input);

    // Then: nothing remains for the body, so the caller can apply a fallback.
    expect(result).toBe('');
  });

  it('truncates long inputs at the configured code-point boundary and appends an ellipsis', () => {
    // Given: a message far longer than the requested limit.
    const input = 'x'.repeat(20);

    // When: truncated to 5 characters.
    const result = sanitizeAgentText(input, 5);

    // Then: the result is exactly the limit plus an ellipsis marker.
    expect(result).toBe('xxxxx…');
  });

  it('keeps surrogate pairs intact when truncating', () => {
    // Given: a message of astral-plane characters that occupy two UTF-16 code units each.
    const input = '😀😀😀😀😀😀';

    // When: truncated to four code points.
    const result = sanitizeAgentText(input, 4);

    // Then: the truncation respects code-point boundaries instead of slicing a surrogate pair.
    expect(result).toBe('😀😀😀😀…');
  });

  it('does not leave whitespace stranded before the truncation marker', () => {
    // Given: a message whose limit falls on the space between two words.
    const input = 'abc defgh';

    // When: truncated to four characters.
    const result = sanitizeAgentText(input, 4);

    // Then: the marker follows the last real character, so the cut does not read as a gap.
    expect(result).toBe('abc…');
  });
});

describe('sanitizeUserPromptText', () => {
  it('keeps the line breaks the user wrote', () => {
    // Given: a prompt written as a list, which is how multi-part instructions usually arrive.
    const input = 'Fix three things:\n1. lint fights Prettier\n2. two tests fail';

    // When: the prompt is sanitized for display.
    const result = sanitizeUserPromptText(input);

    // Then: the structure survives instead of running together into one line.
    expect(result).toBe('Fix three things:\n1. lint fights Prettier\n2. two tests fail');
  });

  it('closes up blank lines and normalizes CRLF to a single break', () => {
    // Given: a prompt with paragraph spacing and Windows-style line endings.
    const input = 'First paragraph.\n\n\nSecond paragraph.\r\nThird line.';

    // When: the prompt is sanitized.
    const result = sanitizeUserPromptText(input);

    // Then: each gap becomes exactly one break. Blank lines say nothing a single break does not,
    // and each would consume a line of the clamped height the prompt is rendered in.
    expect(result).toBe('First paragraph.\nSecond paragraph.\nThird line.');
  });

  it('still collapses runs of spaces and tabs within a line', () => {
    // Given: a line padded with tabs and repeated spaces.
    const input = 'Fix   the \t\t failing   tests';

    // When: the prompt is sanitized.
    const result = sanitizeUserPromptText(input);

    // Then: horizontal whitespace is normalized exactly as it is for agent-authored text.
    expect(result).toBe('Fix the failing tests');
  });

  it('strips escape sequences and non-newline control characters', () => {
    // Given: a prompt carrying ANSI colouring and stray control bytes alongside a real break.
    const bel = String.fromCharCode(7);
    const nul = String.fromCharCode(0);
    const esc = String.fromCharCode(27);
    const input = `${esc}[31mred${esc}[0m${bel}${nul}\nsecond line`;

    // When: the prompt is sanitized.
    const result = sanitizeUserPromptText(input);

    // Then: only the newline survives from the control characters.
    expect(result).toBe('red\nsecond line');
  });

  it('counts a newline as one character when truncating', () => {
    // Given: a two-line prompt longer than the limit.
    const input = 'abc\ndefgh';

    // When: truncated to five code points.
    const result = sanitizeUserPromptText(input, 5);

    // Then: the break costs one code point like any other character, and the cut is marked.
    expect(result).toBe('abc\nd…');
  });

  it('does not strand the truncation marker on a line of its own', () => {
    // Given: a two-line prompt whose limit falls exactly on the line break.
    const input = 'abc\ndefgh';

    // When: truncated to four code points.
    const result = sanitizeUserPromptText(input, 4);

    // Then: the break is dropped rather than kept ahead of the marker. Surfaces rendering this
    // text show breaks and clamp to a few lines, so a lone ellipsis would cost a whole one.
    expect(result).toBe('abc…');
  });
});
