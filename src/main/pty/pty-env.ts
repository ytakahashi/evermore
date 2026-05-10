/**
 * Builds a `process.env` object for `node-pty` so the spawned shell behaves like one launched
 * from iTerm2 or Terminal.app — UTF-8 by default, and PATH built from the user's rc files instead
 * of from however Evermore happened to be launched.
 *
 * Two adjustments matter:
 *
 * - PATH is reset to a launchd-like minimum on POSIX. Login shells re-run `/etc/zprofile`
 *   (`path_helper` on macOS) and `~/.zshrc`, both of which prepend entries to PATH. If we forward
 *   Electron's PATH (already populated by the launching shell when running `pnpm dev`, by GUI
 *   launchctl defaults, etc.), those entries get prepended a second time and the spawned PATH
 *   diverges from a normal terminal session. Resetting gives the rc files a clean slate.
 *
 * - LANG / LC_CTYPE are forced to UTF-8 when the parent did not set a UTF-8 locale. GUI launches
 *   often inherit a minimal environment (no `LANG`, or `LC_ALL=C`), which makes git, `less`, and
 *   other tools render multibyte text as literal byte escapes.
 */
export function buildPtyProcessEnv(
  base: NodeJS.ProcessEnv,
  extras?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  if (process.platform !== 'win32') {
    // Setting (instead of deleting) avoids the trailing-colon trap when an early rc file does
    // `export PATH="$HOME/bin:$PATH"` against an unset PATH — that would inject `.` into PATH.
    // The minimum here matches what launchd hands a freshly launched login shell on macOS; on
    // Linux the same value is a safe baseline that /etc/profile.d/* and rc files extend.
    env['PATH'] = '/usr/bin:/bin:/usr/sbin:/sbin';
  }

  if (env['LC_ALL'] === 'C' || env['LC_ALL'] === 'POSIX') {
    // `LC_ALL` overrides `LANG` / `LC_CTYPE`; a bare C locale from a parent process would block
    // UTF-8 even after we set `LANG` below. Non-C non-UTF-8 values (e.g. `en_US.ISO8859-1`) are
    // left intact: they are rare in GUI launches, and silently dropping a user-set locale would
    // surprise. The UTF-8 injection below is a best effort and may not take effect in that case.
    delete env['LC_ALL'];
  }

  if (!localeEnvIndicatesUtf8(env)) {
    env['LANG'] = defaultUtf8Lang();
    env['LC_CTYPE'] = defaultUtf8Lang();
  }

  if (!env['LESSCHARSET']) {
    // Git and other tools often pipe through `less`; without this, multibyte text can be mangled
    // when the inherited locale is ambiguous.
    env['LESSCHARSET'] = 'utf-8';
  }

  if (extras) {
    // Applied last so a caller (pane-level overrides) can still supply a specific PATH or locale
    // for that PTY without us clobbering it.
    Object.assign(env, extras);
  }

  return env;
}

function localeEnvIndicatesUtf8(env: Record<string, string>): boolean {
  return (
    looksUtf8Locale(env['LC_ALL']) ||
    looksUtf8Locale(env['LANG']) ||
    looksUtf8Locale(env['LC_CTYPE'])
  );
}

function looksUtf8Locale(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const upper = value.toUpperCase();
  return upper.includes('UTF-8') || upper.includes('UTF8');
}

function defaultUtf8Lang(): string {
  // Linux containers and minimal installs often ship `C.UTF-8`; macOS and Windows GUI sessions
  // reliably provide `en_US.UTF-8`.
  return process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8';
}
