const DEFAULT_MAX_CHARS = 200;
const TRUNCATION_MARKER = '…';

// Matches CSI/OSC/SS2/SS3 and bare ESC sequences. Covers the common ANSI color / cursor-move
// sequences as well as terminal-specific escape sequences agents may leak into their messages.
const ANSI_ESCAPE = /\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[NOPX^_])/g; // eslint-disable-line no-control-regex
// Control characters except for \n, \r, \t. \r is normalized later; \t and \n are preserved
// through normalization and then collapsed alongside other whitespace.
const NON_WHITESPACE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g; // eslint-disable-line no-control-regex

/**
 * Normalizes an agent-provided message for use as a macOS notification body.
 *
 * Terminal-oriented agents commonly leak ANSI color codes, OSC sequences, raw control characters,
 * and chunked whitespace into their hook messages. macOS renders these as garbage in notifications,
 * so this helper produces a single-line plain-text rendering safe to drop into a notification:
 *  - strips ANSI / OSC escape sequences
 *  - strips ASCII control characters other than `\n`, `\r`, `\t`
 *  - normalizes `\r\n` / `\r` to `\n`, then collapses any run of whitespace to one space
 *  - truncates to at most `maxChars` code points (surrogate-safe) and appends an ellipsis when cut
 *
 * Returns the empty string when the input has nothing usable left after sanitization; callers are
 * expected to apply their own fallback (for example, the pane cwd basename).
 */
export function sanitizeNotificationBody(
  input: string | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (!input) {
    return '';
  }

  const stripped = input.replace(ANSI_ESCAPE, '').replace(NON_WHITESPACE_CONTROL_CHARS, '');
  const normalizedWhitespace = stripped.replace(/\r\n?/g, '\n').replace(/\s+/g, ' ').trim();
  if (!normalizedWhitespace) {
    return '';
  }

  const codePoints = Array.from(normalizedWhitespace);
  if (codePoints.length <= maxChars) {
    return normalizedWhitespace;
  }

  return codePoints.slice(0, maxChars).join('') + TRUNCATION_MARKER;
}
