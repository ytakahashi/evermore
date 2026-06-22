// Hoisted to avoid allocating a decoder for every command. TextDecoder instances are stateless
// across calls when used without `stream: true`, so a single shared instance is safe.
const OSC_633_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes a VS Code-compatible `OSC 633;E` command-line field.
 *
 * The input must be the encoded command field only, without the leading `E;` or an optional nonce.
 * Literal backslashes use `\\`, while escaped bytes use `\xNN`. Consecutive escaped bytes are
 * decoded together as UTF-8 so multibyte command text round-trips exactly.
 *
 * Returns `null` when an escape is malformed or escaped bytes are not valid complete UTF-8.
 */
export function decodeOsc633CommandLine(encodedCommand: string): string | null {
  let decoded = '';
  let pendingBytes: number[] = [];

  const flushPendingBytes = (): boolean => {
    if (pendingBytes.length === 0) {
      return true;
    }

    try {
      decoded += OSC_633_UTF8_DECODER.decode(Uint8Array.from(pendingBytes));
      pendingBytes = [];
      return true;
    } catch (_error: unknown) {
      // A malformed command payload is ignored by shell-integration consumers. Returning null
      // keeps invalid terminal metadata from affecting the raw PTY stream or renderer state.
      return false;
    }
  };

  for (let index = 0; index < encodedCommand.length; index += 1) {
    const char = encodedCommand[index];
    if (char !== '\\') {
      if (!flushPendingBytes()) {
        return null;
      }
      decoded += char;
      continue;
    }

    const next = encodedCommand[index + 1];
    if (next === '\\') {
      pendingBytes.push('\\'.charCodeAt(0));
      index += 1;
      continue;
    }

    if (next === 'x') {
      const hex = encodedCommand.slice(index + 2, index + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        pendingBytes.push(Number.parseInt(hex, 16));
        index += 3;
        continue;
      }
    }

    return null;
  }

  return flushPendingBytes() ? decoded : null;
}
