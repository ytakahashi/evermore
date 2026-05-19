/**
 * Builders for Evermore's ZDOTDIR-based shell-integration forwarding scripts.
 *
 * Each returned string is the literal content of a startup file placed inside an Evermore-managed
 * ZDOTDIR (`<userData>/shell-integration/zsh/`). When the PTY launches `zsh -l`, zsh reads these
 * forwarding scripts instead of the user's real rc files; each forwarding script then sources the
 * corresponding user rc by temporarily restoring the user-visible `ZDOTDIR`, and resets it back to
 * the Evermore directory so zsh keeps finding the next forwarding script.
 *
 * The non-trivial invariant — "during startup-file search, ZDOTDIR must stay = Evermore; while
 * sourcing user rc, ZDOTDIR must look like the user expects" — is implemented by the
 * `_evermore_source_user_rc` helper defined in `.zshenv` (the first file zsh always reads).
 *
 * See `design_doc/Evermore/OSC_133_AUTO_INJECTION.md` §採用案: ZDOTDIR-based injection.
 */

/**
 * Returns the content of `.zshenv`, which defines the helpers used by every other forwarding
 * script and then sources the user's `.zshenv`.
 *
 * `.zshenv` is read for every zsh invocation regardless of interactivity / login state, so the
 * helpers it defines are visible to `.zprofile` / `.zshrc` / `.zlogin` later in the startup chain.
 */
export function buildZshenv(): string {
  return `# Evermore shell-integration forwarding: .zshenv
# Initialize user-visible ZDOTDIR tracking from env passed in by Evermore.
if [[ "\${EVERMORE_ORIGINAL_ZDOTDIR_SET:-0}" == "1" ]]; then
  typeset -g __evermore_user_zdotdir_set=1
  typeset -g __evermore_user_zdotdir="\${EVERMORE_ORIGINAL_ZDOTDIR:-}"
else
  typeset -g __evermore_user_zdotdir_set=0
  typeset -g __evermore_user_zdotdir=""
fi

# Source one of the user's rc files (".zshenv" / ".zprofile" / ".zshrc" / ".zlogin") from the
# user-visible ZDOTDIR. After sourcing, capture any ZDOTDIR change the user rc may have made so
# the next user rc lookup uses that location, then restore ZDOTDIR to the Evermore directory so
# zsh keeps reading Evermore's forwarding scripts as the next startup file.
_evermore_source_user_rc() {
  local rc_name="$1"
  local source_dir

  if [[ "$__evermore_user_zdotdir_set" == "1" ]]; then
    export ZDOTDIR="$__evermore_user_zdotdir"
    source_dir="\${ZDOTDIR:-$HOME}"
  else
    unset ZDOTDIR
    source_dir="$HOME"
  fi

  if [[ -f "$source_dir/$rc_name" ]]; then
    builtin . "$source_dir/$rc_name"
  fi

  if [[ -n "\${ZDOTDIR+x}" ]]; then
    typeset -g __evermore_user_zdotdir_set=1
    typeset -g __evermore_user_zdotdir="$ZDOTDIR"
  else
    typeset -g __evermore_user_zdotdir_set=0
    typeset -g __evermore_user_zdotdir=""
  fi

  export ZDOTDIR="$EVERMORE_INJECT_ZDOTDIR"
}

# Final cleanup: restore the user-visible ZDOTDIR (matching the user's pre-Evermore env exactly,
# including the unset case) and remove every auto-injection variable / helper so subshells started
# inside the Evermore PTY do not inherit the injection.
_evermore_finalize_zdotdir() {
  if [[ "$__evermore_user_zdotdir_set" == "1" ]]; then
    export ZDOTDIR="$__evermore_user_zdotdir"
  else
    unset ZDOTDIR
  fi
  unset EVERMORE_INJECT_ZDOTDIR EVERMORE_ORIGINAL_ZDOTDIR_SET EVERMORE_ORIGINAL_ZDOTDIR
  unset __evermore_user_zdotdir_set __evermore_user_zdotdir
  unset -f _evermore_source_user_rc _evermore_finalize_zdotdir
}

_evermore_source_user_rc .zshenv
`;
}

/**
 * Returns the content of `.zprofile`, sourced by login shells after `.zshenv`.
 */
export function buildZprofile(): string {
  return `# Evermore shell-integration forwarding: .zprofile
_evermore_source_user_rc .zprofile
`;
}

/**
 * Returns the content of `.zshrc`, sourced by interactive shells after `.zshenv` (and after
 * `.zprofile` for login shells).
 *
 * The Evermore snippet is sourced exclusively from here because it registers zle widgets / hooks
 * that only matter in interactive shells. Non-login interactive shells do not read `.zlogin`, so
 * the final user-visible ZDOTDIR restore happens here for that case; login interactive shells
 * defer the final restore to `.zlogin`.
 */
export function buildZshrc(): string {
  return `# Evermore shell-integration forwarding: .zshrc
_evermore_source_user_rc .zshrc

builtin . "$EVERMORE_INJECT_ZDOTDIR/evermore-shell-integration.zsh"

if [[ ! -o login ]]; then
  _evermore_finalize_zdotdir
fi
`;
}

/**
 * Returns the content of `.zlogin`, sourced by login shells after `.zshrc`.
 *
 * This is the last file zsh reads for a login shell, so the final user-visible ZDOTDIR restore
 * lives here for that case.
 */
export function buildZlogin(): string {
  return `# Evermore shell-integration forwarding: .zlogin
_evermore_source_user_rc .zlogin
_evermore_finalize_zdotdir
`;
}
