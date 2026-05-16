/**
 * Encodes a shell command line for VS Code-compatible `OSC 633;E` transport.
 *
 * JavaScript strings are UTF-16, while the shell snippet emits byte-oriented UTF-8 escapes.
 * Keep this reference implementation byte-based by converting with `TextEncoder` before escaping.
 */
export function encodeOsc633CommandLine(command: string): string {
  const bytes = new TextEncoder().encode(command);
  let encoded = '';

  for (const byte of bytes) {
    if (byte === 0x5c) {
      encoded += '\\\\';
    } else if (shouldEscapeByte(byte)) {
      encoded += `\\x${byte.toString(16).padStart(2, '0')}`;
    } else {
      encoded += String.fromCharCode(byte);
    }
  }

  return encoded;
}

function shouldEscapeByte(byte: number): boolean {
  // Escape:
  //   - 0x3b (`;`): OSC parameter separator; an unescaped one would split the payload.
  //   - < 0x20 / 0x7f: C0 / DEL control bytes, including BEL (0x07) and ESC (0x1b) which would
  //     otherwise terminate the OSC payload mid-command.
  //   - >= 0x80: multibyte UTF-8 continuation bytes; the parser reassembles them via TextDecoder.
  return byte === 0x3b || byte < 0x20 || byte === 0x7f || byte >= 0x80;
}
