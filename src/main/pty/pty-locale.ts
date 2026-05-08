/**
 * Builds a `process.env` object for `node-pty` that makes UTF-8 the default for child CLIs.
 *
 * When Evermore is launched from the macOS dock or another GUI path, the main process often
 * inherits a minimal environment (no `LANG`, or `LC_ALL=C` from a parent). Git, `less`, and other
 * tools then treat the session as non-UTF-8 and print non-ASCII as literal byte escapes.
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
