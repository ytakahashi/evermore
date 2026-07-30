const DEFAULT_MAX_CHARS = 200;
const TRUNCATION_MARKER = '…';

// Matches CSI/OSC/SS2/SS3 and bare ESC sequences. Covers the common ANSI color / cursor-move
// sequences as well as terminal-specific escape sequences agents may leak into their messages.
const ANSI_ESCAPE = /\x1B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[NOPX^_])/g; // eslint-disable-line no-control-regex
// Control characters except for \n, \r, \t. \r is normalized to \n before either collapse
// strategy runs; what becomes of \t and \n after that is the caller's decision, since the two
// exported functions differ precisely in whether a line break survives.
const NON_WHITESPACE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g; // eslint-disable-line no-control-regex

/**
 * Normalizes agent-provided text (hook `message`/`activityLabel`/`toolName` fields) for safe
 * display in both the macOS notification body and the Sidebar.
 *
 * Terminal-oriented agents commonly leak ANSI color codes, OSC sequences, raw control characters,
 * and chunked whitespace into their hook payloads. This helper produces a single-line plain-text
 * rendering safe to use in either surface:
 *  - strips ANSI / OSC escape sequences
 *  - strips ASCII control characters other than `\n`, `\r`, `\t`
 *  - normalizes `\r\n` / `\r` to `\n`, then collapses any run of whitespace to one space
 *  - truncates to at most `maxChars` code points (surrogate-safe) and appends an ellipsis when cut
 *
 * Returns the empty string when the input has nothing usable left after sanitization; callers are
 * expected to apply their own fallback (for example, the pane cwd basename).
 */
export function sanitizeAgentText(
  input: string | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  return sanitize(input, maxChars, (text) => text.replace(/\s+/g, ' '));
}

/**
 * Variant of {@link sanitizeAgentText} that keeps line structure, for text the user wrote.
 *
 * Applies the same escape-stripping and truncation, but collapses whitespace within a line only, so
 * a prompt written as a list or in paragraphs still reads as one. Blank lines are closed up rather
 * than reproduced: they carry no information a single break does not, and each one would consume a
 * line of the clamped height the prompt is displayed in.
 *
 * Kept separate from {@link sanitizeAgentText} rather than added as an option, because that
 * function's single-line guarantee is what makes its output safe to drop into a macOS notification
 * body and a truncated sidebar row. Surfaces rendering this one must opt into showing the breaks
 * (`white-space: pre-line`); where they do not, a newline renders as a space and the result matches
 * the single-line form anyway.
 */
export function sanitizeUserPromptText(
  input: string | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  return sanitize(input, maxChars, (text) =>
    text
      // Every whitespace run that contains a newline becomes exactly one newline; this is what
      // closes up blank lines. Runs without one collapse to a space as usual.
      .replace(/[^\S\n]*\n\s*/g, '\n')
      .replace(/[^\S\n]+/g, ' '),
  );
}

function sanitize(
  input: string | undefined,
  maxChars: number,
  collapseWhitespace: (text: string) => string,
): string {
  if (!input) {
    return '';
  }

  const stripped = input.replace(ANSI_ESCAPE, '').replace(NON_WHITESPACE_CONTROL_CHARS, '');
  const normalizedWhitespace = collapseWhitespace(stripped.replace(/\r\n?/g, '\n')).trim();
  if (!normalizedWhitespace) {
    return '';
  }

  const codePoints = Array.from(normalizedWhitespace);
  if (codePoints.length <= maxChars) {
    return normalizedWhitespace;
  }

  // Trailing whitespace is dropped before the marker so the cut never reads as an artifact of it.
  // On a surface that renders line breaks, a cut landing on one would otherwise spend a whole line
  // of the clamped height on a lone ellipsis.
  return codePoints.slice(0, maxChars).join('').trimEnd() + TRUNCATION_MARKER;
}
