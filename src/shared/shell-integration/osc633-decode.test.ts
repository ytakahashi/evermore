import { describe, expect, it } from 'vitest';
import { encodeOsc633CommandLine } from './osc633-encode';
import { decodeOsc633CommandLine } from './osc633-decode';

describe('decodeOsc633CommandLine', () => {
  it('decodes separators, control bytes, and literal backslashes', () => {
    // Given: a command field encoded with the VS Code-compatible OSC 633 escaping rules.
    const encoded = 'echo a\\x3bb\\\\c\\x0aline2\\x0d\\x00done';

    // When: the encoded command field is decoded.
    const decoded = decodeOsc633CommandLine(encoded);

    // Then: each escaped byte and literal backslash is restored exactly.
    expect(decoded).toBe('echo a;b\\c\nline2\r\0done');
  });

  it('round-trips printable, multiline, and multibyte command lines', () => {
    // Given: commands covering ASCII, control bytes, and UTF-8 multibyte characters.
    const commands = [
      'pnpm run dev; ls',
      "printf 'a\\b'",
      'cat <<EOF\n日本語🙂\nEOF',
      'line1\r\0line2',
    ];

    // When: each command is encoded and decoded.
    const decoded = commands.map((command) =>
      decodeOsc633CommandLine(encodeOsc633CommandLine(command)),
    );

    // Then: the original JavaScript strings are restored without normalization.
    expect(decoded).toEqual(commands);
  });

  it('accepts uppercase hexadecimal escapes', () => {
    // Given: a valid byte escape using uppercase hexadecimal digits.
    const encoded = 'echo\\x20\\x4A';

    // When: the field is decoded.
    const decoded = decodeOsc633CommandLine(encoded);

    // Then: hexadecimal matching is case-insensitive.
    expect(decoded).toBe('echo J');
  });

  it('returns an empty string for an empty field', () => {
    // Given: an empty encoded command field.
    const encoded = '';

    // When: the field is decoded.
    const decoded = decodeOsc633CommandLine(encoded);

    // Then: decoding remains a pure transformation; consumers decide whether empty is valid.
    expect(decoded).toBe('');
  });

  it.each([
    ['unknown escape', '\\q'],
    ['short hex escape', '\\x0'],
    ['non-hex escape', '\\x0G'],
    ['trailing backslash', 'echo\\'],
    ['incomplete UTF-8', '\\xe6\\x97'],
    ['invalid UTF-8', '\\xff'],
    ['escaped byte interrupted by ASCII', '\\xe6x\\x97\\xa5'],
  ])('rejects %s', (_name, encoded) => {
    // Given: a malformed OSC 633 command field.

    // When: the field is decoded.
    const decoded = decodeOsc633CommandLine(encoded);

    // Then: malformed metadata is rejected rather than partially decoded.
    expect(decoded).toBeNull();
  });
});
