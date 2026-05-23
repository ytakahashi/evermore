import type { PaneKnownAgent } from '../../shared/types';

/**
 * Result of detecting an AI agent from a command line.
 *
 * `kind` retains the raw basename (`'cursor-agent'`, `'agy'`, etc.) so telemetry and future
 * unknown-agent display can keep the original token, while `known` is the curated subset used by
 * the sidebar for icon and color mapping.
 */
export interface DetectedAgent {
  known: PaneKnownAgent;
  kind: string;
}

/**
 * Command tokens that act as transparent wrappers around the real command. When detection sees one
 * as the leading token, it consumes the wrapper, any `KEY=value` env assignments, any `-X`-style
 * flags, and the value paired with select flags that take a separate value (see
 * {@link VALUE_FLAGS_BY_WRAPPER}). The agent binary the user actually invoked is the first
 * non-wrapper, non-assignment, non-flag token that follows.
 *
 * `env` and `exec` are POSIX builtins; `command` skips function lookup; `sudo` runs as another
 * user.
 */
const COMMAND_WRAPPERS = new Set(['env', 'command', 'exec', 'sudo']);

/**
 * For wrappers whose flags can take a value as a separate token, list the flag names that should
 * cause the next token to be consumed as part of the flag. Coverage is deliberately limited to the
 * common forms users invoke before an agent binary (`env -u VAR`, `env -C dir`, `sudo -u user`,
 * `sudo -g group`, etc.); flags absent from this list are still skipped, but their value would be
 * read as the command and detection would return `undefined`.
 */
const VALUE_FLAGS_BY_WRAPPER: Record<string, ReadonlySet<string>> = {
  env: new Set(['-u', '-C', '-S']),
  sudo: new Set(['-u', '-g', '-h', '-D', '-r', '-t', '-T', '-p']),
};

const EMPTY_VALUE_FLAGS: ReadonlySet<string> = new Set<string>();

const BASENAME_TO_AGENT: ReadonlyArray<{ basename: string; agent: DetectedAgent }> = [
  { basename: 'claude', agent: { known: 'claude', kind: 'claude' } },
  { basename: 'codex', agent: { known: 'codex', kind: 'codex' } },
  { basename: 'cursor-agent', agent: { known: 'cursor', kind: 'cursor-agent' } },
  { basename: 'agent', agent: { known: 'cursor', kind: 'agent' } },
  { basename: 'agy', agent: { known: 'antigravity', kind: 'agy' } },
];

/**
 * Detects whether `commandLine` invokes a known AI agent.
 *
 * Returns `undefined` for empty input, unknown commands, or shapes the helper does not attempt to
 * parse. Shell-complete parsing is out of scope: the input is expected to be a command line that a
 * shell already executed (typically OSC 633;E or a process-table `args` field), so token-level
 * splitting on whitespace is sufficient.
 */
export function detectAgentFromCommand(commandLine: string | undefined): DetectedAgent | undefined {
  if (!commandLine) {
    return undefined;
  }

  const tokens = commandLine.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return undefined;
  }

  let index = 0;
  // Walk past wrappers, env-style `KEY=value` assignments, and wrapper flags. Multiple wrappers
  // can stack (`sudo env FOO=1 claude`), so the loop alternates wrapper consumption with the
  // inner flag/assignment-skipping loop until a real command token is reached.
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (COMMAND_WRAPPERS.has(token)) {
      const valueFlags = VALUE_FLAGS_BY_WRAPPER[token] ?? EMPTY_VALUE_FLAGS;
      index += 1;
      while (index < tokens.length) {
        const next = tokens[index] ?? '';
        if (isEnvAssignment(next)) {
          index += 1;
          continue;
        }
        if (next.startsWith('-')) {
          index += 1;
          // Flags that take a separate value (e.g. `sudo -u root`) need that value consumed too.
          // `--long=value` already carries its value in one token and is handled by the
          // unconditional skip above. Flags not in `valueFlags` are skipped without consuming the
          // next token, which is correct for boolean flags like `sudo -E` or `env -i`.
          if (valueFlags.has(next) && index < tokens.length) {
            index += 1;
          }
          continue;
        }
        break;
      }
      continue;
    }
    if (isEnvAssignment(token)) {
      index += 1;
      continue;
    }
    break;
  }

  const commandToken = tokens[index];
  if (!commandToken) {
    return undefined;
  }

  const basename = getBasename(commandToken);
  if (!basename) {
    return undefined;
  }

  const match = BASENAME_TO_AGENT.find((entry) => entry.basename === basename);
  return match?.agent;
}

function isEnvAssignment(token: string): boolean {
  // Matches the `NAME=value` form that `env` and bare shell prefixes use. The name must start with
  // a letter or underscore so flag-like tokens (`-e`, `--unset=FOO`) are not mistaken for one.
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function getBasename(commandToken: string): string {
  const lastSlash = commandToken.lastIndexOf('/');
  return lastSlash >= 0 ? commandToken.slice(lastSlash + 1) : commandToken;
}
