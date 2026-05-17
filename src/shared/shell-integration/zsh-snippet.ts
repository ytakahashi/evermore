/**
 * Zsh shell integration snippet for Evermore.
 *
 * Users paste this into the end of ~/.zshrc. The snippet emits OSC 7 (cwd), OSC 133 (prompt and
 * command lifecycle markers), and OSC 633;E (exact command line) so the Evermore sidebar can
 * report pane state with shell-level accuracy instead of process-table heuristics.
 *
 * The OSC 633;E payload encoder mirrors `encodeOsc633CommandLine` in `./osc633-encode.ts` so the
 * main-process `TerminalSignalParser` round-trips multibyte command lines exactly.
 *
 * Sentinel guards keep the snippet a no-op when another terminal emulator's shell integration is
 * already active (VS Code / Warp / WezTerm / iTerm / Ghostty). Evermore sets `TERM_PROGRAM=Evermore`
 * on PTY spawn so its own panes are never skipped.
 *
 * The snippet is idempotent on re-source via the `EVERMORE_SHELL_INTEGRATION` flag; hooks and
 * widgets are registered exactly once per shell session.
 */
export const EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET = `# Evermore shell integration for zsh.
# Paste this whole block at the end of ~/.zshrc. Re-sourcing the file is safe (idempotent).
_evermore_install_shell_integration() {
  # Re-source guard: hooks and widgets are not re-registered on subsequent sources.
  [[ -n \${EVERMORE_SHELL_INTEGRATION-} ]] && return
  # zsh-only; no-op when sourced from bash / sh / fish.
  [[ -n \${ZSH_VERSION-} ]] || return
  # Non-interactive shells (scripts, ssh-run commands) do not need lifecycle markers.
  [[ -o interactive ]] || return
  # If another terminal emulator's shell integration is already active, defer to it instead of
  # double-emitting. Evermore sets TERM_PROGRAM=Evermore so its own panes are never skipped here.
  if [[ \${TERM_PROGRAM-} != Evermore ]]; then
    case \${TERM_PROGRAM-} in
      vscode|WarpTerminal|WezTerm|iTerm.app|ghostty) return ;;
    esac
    [[ -n \${VSCODE_INJECTION-} ]] && return
  fi

  typeset -g EVERMORE_SHELL_INTEGRATION=1

  autoload -Uz add-zsh-hook

  # OSC 633;E command-line encoder. Matches encodeOsc633CommandLine() in
  # src/shared/shell-integration/osc633-encode.ts so multibyte command lines round-trip exactly.
  _evermore_encode_command() {
    emulate -L zsh
    setopt no_multibyte
    local input="$1" i ch byte_val byte out=""
    for (( i = 1; i <= \${#input}; i++ )); do
      ch=\${input[i]}
      printf -v byte_val '%d' "'$ch"
      if (( byte_val == 0x5c )); then
        out+='\\\\'
      elif (( byte_val == 0x3b || byte_val < 0x20 || byte_val == 0x7f || byte_val >= 0x80 )); then
        printf -v byte '\\\\x%02x' $byte_val
        out+=$byte
      else
        out+=$ch
      fi
    done
    print -r -- "$out"
  }

  # cwd encoder. Matches the iTerm2 OSC 7 convention (file:// URL with percent-encoded path).
  _evermore_chpwd() {
    emulate -L zsh
    setopt no_multibyte
    local i ch hex out=""
    for (( i = 1; i <= \${#PWD}; i++ )); do
      ch=\${PWD[i]}
      case $ch in
        [a-zA-Z0-9/._~-]) out+=$ch ;;
        *) printf -v hex '%%%02X' "'$ch"; out+=$hex ;;
      esac
    done
    printf '\\e]7;file://%s%s\\a' "$HOST" "$out"
  }

  # preexec: emit the user-submitted command line and the command-started marker.
  _evermore_preexec() {
    printf '\\e]633;E;%s\\a' "$(_evermore_encode_command "$1")"
    printf '\\e]133;C\\a'
    typeset -g _evermore_executed=1
  }

  # precmd: emit the previous command's exit code, then the new prompt-start marker.
  # The very first prompt (before any command has run) intentionally emits A only.
  _evermore_precmd() {
    local exit_code=$?
    if [[ -n \${_evermore_executed-} ]]; then
      printf '\\e]133;D;%d\\a' $exit_code
    fi
    printf '\\e]133;A\\a'
  }

  add-zsh-hook preexec _evermore_preexec
  add-zsh-hook precmd _evermore_precmd
  add-zsh-hook chpwd _evermore_chpwd

  # zle-line-init widget: emit OSC 133;B right before the line editor accepts user input.
  # Using a widget (not a PS1 append) survives dynamic prompts like starship and powerlevel10k
  # which rewrite PS1 in their own precmd hooks after ours.
  _evermore_zle_line_init() {
    printf '\\e]133;B\\a'
    if zle -l _evermore_orig_zle_line_init >/dev/null 2>&1; then
      zle _evermore_orig_zle_line_init
    fi
  }
  # Preserve any existing zle-line-init widget so its behavior still runs after our marker.
  # Save first, install second; the reverse order would lose the original widget.
  if zle -l zle-line-init >/dev/null 2>&1; then
    zle -A zle-line-init _evermore_orig_zle_line_init
  fi
  zle -N _evermore_zle_line_init
  zle -A _evermore_zle_line_init zle-line-init

  # Emit the initial OSC 7 once so workspace cwd is correct before the first cd.
  _evermore_chpwd
}

_evermore_install_shell_integration
unfunction _evermore_install_shell_integration
`;
