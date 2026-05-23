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
 * as the leading token, it consumes the wrapper plus any leading `KEY=value` env assignments and
 * advances to the next non-assignment token.
 *
 * `env` and `exec` are POSIX builtins; `command` skips function lookup; `sudo` runs as another user.
 * In each case the agent binary the user actually invoked is the first non-flag, non-assignment
 * token that follows.
 */
const COMMAND_WRAPPERS = new Set(['env', 'command', 'exec', 'sudo']);

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
  // Walk past wrapper commands and env-style `KEY=value` assignments. Multiple wrappers can stack
  // (`sudo env FOO=1 claude`), and `env` is the one that legitimately takes `KEY=value` arguments
  // before the real binary, so the loop alternates wrapper consumption and assignment skipping
  // until a real command token is reached.
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (COMMAND_WRAPPERS.has(token)) {
      index += 1;
      while (index < tokens.length && isEnvAssignment(tokens[index] ?? '')) {
        index += 1;
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
