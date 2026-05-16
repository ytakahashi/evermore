import { describe, expect, it } from 'vitest';
import { encodeOsc633CommandLine } from './osc633-encode';

describe('encodeOsc633CommandLine', () => {
  it('escapes OSC separators while leaving printable ASCII readable', () => {
    // Given: a command containing an OSC parameter separator.
    const command = 'echo hi; ls';

    // When: the command is encoded for OSC 633;E.
    const encoded = encodeOsc633CommandLine(command);

    // Then: only the semicolon needs hex escaping.
    expect(encoded).toBe('echo hi\\x3b ls');
  });

  it('escapes backslashes using the VS Code-compatible double-backslash form', () => {
    // Given: a command containing a literal backslash.
    const command = "printf 'a\\b'";

    // When: the command is encoded for OSC 633;E.
    const encoded = encodeOsc633CommandLine(command);

    // Then: the backslash is represented by `\\`, not a raw OSC payload backslash.
    expect(encoded).toBe("printf 'a\\\\b'");
  });

  it('encodes UTF-8 bytes as hex escapes instead of UTF-16 code units', () => {
    // Given: a command containing multibyte characters.
    const command = 'echo 日本語';

    // When: the command is encoded for OSC 633;E.
    const encoded = encodeOsc633CommandLine(command);

    // Then: the non-ASCII characters are emitted as UTF-8 bytes.
    expect(encoded).toBe('echo \\xe6\\x97\\xa5\\xe6\\x9c\\xac\\xe8\\xaa\\x9e');
  });

  it('escapes control bytes', () => {
    // Given: a command containing newline, carriage return, and NUL bytes.
    const command = 'line1\nline2\r\0done';

    // When: the command is encoded for OSC 633;E.
    const encoded = encodeOsc633CommandLine(command);

    // Then: control bytes are represented as hex escapes.
    expect(encoded).toBe('line1\\x0aline2\\x0d\\x00done');
  });
});
