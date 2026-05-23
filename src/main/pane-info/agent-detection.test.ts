import { describe, expect, it } from 'vitest';
import { detectAgentFromCommand } from './agent-detection';

describe('detectAgentFromCommand', () => {
  it('returns undefined for empty or whitespace-only input', () => {
    // Given: empty / whitespace input.
    // When: detection runs.
    // Then: nothing is detected.
    expect(detectAgentFromCommand(undefined)).toBeUndefined();
    expect(detectAgentFromCommand('')).toBeUndefined();
    expect(detectAgentFromCommand('   ')).toBeUndefined();
  });

  it('detects bare known agents by basename', () => {
    // Given / When / Then: each known basename maps to its curated agent.
    expect(detectAgentFromCommand('claude')).toEqual({ known: 'claude', kind: 'claude' });
    expect(detectAgentFromCommand('codex')).toEqual({ known: 'codex', kind: 'codex' });
    expect(detectAgentFromCommand('cursor-agent')).toEqual({
      known: 'cursor',
      kind: 'cursor-agent',
    });
    expect(detectAgentFromCommand('agent')).toEqual({ known: 'cursor', kind: 'agent' });
    expect(detectAgentFromCommand('agy')).toEqual({ known: 'antigravity', kind: 'agy' });
  });

  it('uses the basename when the command is an absolute path', () => {
    // Given: an agent invoked through an absolute path.
    // When: detection runs.
    // Then: the basename drives the mapping.
    expect(detectAgentFromCommand('/opt/homebrew/bin/codex')).toEqual({
      known: 'codex',
      kind: 'codex',
    });
    expect(detectAgentFromCommand('/usr/local/bin/claude --help')).toEqual({
      known: 'claude',
      kind: 'claude',
    });
  });

  it('skips leading env-style assignments before the command', () => {
    // Given: shells permit `FOO=bar command` to set env for a single invocation.
    // When: detection sees that shape.
    // Then: the assignments are skipped and the real command token is read.
    expect(detectAgentFromCommand('FOO=bar codex')).toEqual({ known: 'codex', kind: 'codex' });
    expect(detectAgentFromCommand('FOO=1 BAR=2 claude')).toEqual({
      known: 'claude',
      kind: 'claude',
    });
  });

  it('peels off env / command / exec / sudo wrappers and their assignments', () => {
    // Given: common transparent wrappers users invoke before the agent binary.
    // When: detection encounters them.
    // Then: the wrapper (and any `KEY=value` arguments it takes) is consumed and the next token is
    // treated as the command.
    expect(detectAgentFromCommand('env FOO=bar codex')).toEqual({ known: 'codex', kind: 'codex' });
    expect(detectAgentFromCommand('command claude')).toEqual({ known: 'claude', kind: 'claude' });
    expect(detectAgentFromCommand('exec claude --resume')).toEqual({
      known: 'claude',
      kind: 'claude',
    });
    expect(detectAgentFromCommand('sudo claude')).toEqual({ known: 'claude', kind: 'claude' });
    expect(detectAgentFromCommand('sudo env FOO=1 agy')).toEqual({
      known: 'antigravity',
      kind: 'agy',
    });
  });

  it('keeps the original basename in `kind` for cursor-agent vs agent', () => {
    // Given: Cursor publishes two basenames for the same product.
    // When: each is detected.
    // Then: both map to `known: 'cursor'`, but `kind` preserves which one was invoked.
    expect(detectAgentFromCommand('cursor-agent')).toEqual({
      known: 'cursor',
      kind: 'cursor-agent',
    });
    expect(detectAgentFromCommand('agent')).toEqual({ known: 'cursor', kind: 'agent' });
  });

  it('returns undefined for unknown command basenames', () => {
    // Given: command lines unrelated to a known agent.
    // When: detection runs.
    // Then: nothing is returned.
    expect(detectAgentFromCommand('pnpm run dev')).toBeUndefined();
    expect(detectAgentFromCommand('/bin/zsh -l')).toBeUndefined();
    expect(detectAgentFromCommand('node ./script.js')).toBeUndefined();
  });

  it('does not detect a local agent when the command is an ssh invocation that mentions one', () => {
    // Given: an `ssh host claude` command line (the user is opening an SSH session that will run a
    // remote agent).
    // When: detection sees the leading `ssh` basename.
    // Then: no local agent is reported. The classification of remote-vs-local is handled at the
    // tracker layer (which suppresses agent updates while `foregroundSession.kind === 'ssh'`); this
    // assertion is the unit-level guard ensuring the helper does not pre-empt that decision.
    expect(detectAgentFromCommand('ssh host claude')).toBeUndefined();
  });
});
