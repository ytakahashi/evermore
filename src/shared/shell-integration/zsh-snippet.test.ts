import { describe, expect, it } from 'vitest';
import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from './zsh-snippet';

describe('EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET', () => {
  it('runs only once per session via the EVERMORE_SHELL_INTEGRATION guard', () => {
    // Given / When: the snippet text is inspected.
    // Then: it exposes the idempotency guard and sets the flag inside the installer body.
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      '[[ -n ${EVERMORE_SHELL_INTEGRATION-} ]] && return',
    );
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'typeset -g EVERMORE_SHELL_INTEGRATION=1',
    );
  });

  it('limits itself to interactive zsh sessions', () => {
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('[[ -n ${ZSH_VERSION-} ]] || return');
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('[[ -o interactive ]] || return');
  });

  it('defers to another terminal emulator shell integration when not running under Evermore', () => {
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('${TERM_PROGRAM-} != Evermore');
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'vscode|WarpTerminal|WezTerm|iTerm.app|ghostty',
    );
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('[[ -n ${VSCODE_INJECTION-} ]]');
  });

  it('wires OSC 133 / 633 / 7 lifecycle markers through add-zsh-hook', () => {
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'add-zsh-hook preexec _evermore_preexec',
    );
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'add-zsh-hook precmd _evermore_precmd',
    );
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('add-zsh-hook chpwd _evermore_chpwd');
  });

  it('emits OSC 633;E before OSC 133;C on preexec', () => {
    const preexecBody = extractFunctionBody(
      EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
      '_evermore_preexec',
    );
    const oscEIndex = preexecBody.indexOf('\\e]633;E;');
    const oscCIndex = preexecBody.indexOf('\\e]133;C');
    expect(oscEIndex).toBeGreaterThanOrEqual(0);
    expect(oscCIndex).toBeGreaterThan(oscEIndex);
  });

  it('emits OSC 133;D with the previous exit code before OSC 133;A on precmd', () => {
    const precmdBody = extractFunctionBody(
      EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
      '_evermore_precmd',
    );
    expect(precmdBody).toContain('local exit_code=$?');
    const oscDIndex = precmdBody.indexOf('\\e]133;D;%d');
    const oscAIndex = precmdBody.indexOf('\\e]133;A');
    expect(oscDIndex).toBeGreaterThanOrEqual(0);
    expect(oscAIndex).toBeGreaterThan(oscDIndex);
  });

  it('suppresses the leading D before the first command has run', () => {
    const precmdBody = extractFunctionBody(
      EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
      '_evermore_precmd',
    );
    // D is gated by _evermore_executed; preexec is the only place that sets it.
    expect(precmdBody).toContain('[[ -n ${_evermore_executed-} ]]');
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('typeset -g _evermore_executed=1');
  });

  it('emits OSC 133;B from a zle-line-init widget that preserves any existing widget', () => {
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'zle -A zle-line-init _evermore_orig_zle_line_init',
    );
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain('zle -N _evermore_zle_line_init');
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'zle -A _evermore_zle_line_init zle-line-init',
    );
    // The save (-A old new) must precede the install (-A new zle-line-init); otherwise the
    // original widget would be lost before being aliased to _evermore_orig_zle_line_init.
    const saveIndex = EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET.indexOf(
      'zle -A zle-line-init _evermore_orig_zle_line_init',
    );
    const installIndex = EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET.indexOf(
      'zle -A _evermore_zle_line_init zle-line-init',
    );
    expect(saveIndex).toBeLessThan(installIndex);
  });

  it('removes the temporary installer function after running it', () => {
    expect(EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET).toContain(
      'unfunction _evermore_install_shell_integration',
    );
  });
});

/**
 * Returns the body between the first `funcName() {` and its matching closing brace.
 *
 * Used by tests that need to assert the ordering of statements inside a specific hook function
 * without being fooled by occurrences of the same token elsewhere in the snippet.
 */
function extractFunctionBody(snippet: string, funcName: string): string {
  const header = `${funcName}() {`;
  const start = snippet.indexOf(header);
  if (start < 0) {
    throw new Error(`function not found: ${funcName}`);
  }

  let depth = 0;
  let cursor = start + header.length - 1;
  for (; cursor < snippet.length; cursor += 1) {
    const ch = snippet[cursor];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return snippet.slice(start + header.length, cursor);
      }
    }
  }
  throw new Error(`unbalanced braces while extracting ${funcName}`);
}
