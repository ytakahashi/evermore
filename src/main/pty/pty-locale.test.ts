import { describe, expect, it } from 'vitest';
import { buildPtyProcessEnv } from './pty-locale';

describe('buildPtyProcessEnv', () => {
  it('adds UTF-8 LANG/LC_CTYPE when no UTF-8 locale is present', () => {
    // Given: an environment like Electron started without a login shell locale.
    const env = buildPtyProcessEnv({
      PATH: '/usr/bin',
      HOME: '/Users/tester',
    });

    // Then: UTF-8 defaults are injected so CLIs do not escape multibyte output.
    expect(env['LANG']).toMatch(/UTF-8/i);
    expect(env['LC_CTYPE']).toBe(env['LANG']);
    expect(env['LESSCHARSET']).toBe('utf-8');
    if (process.platform === 'linux') {
      expect(env['LANG']).toBe('C.UTF-8');
    } else {
      expect(env['LANG']).toBe('en_US.UTF-8');
    }
  });

  it('does not override an existing UTF-8 LANG', () => {
    // Given: a typical interactive shell environment.
    const env = buildPtyProcessEnv({
      LANG: 'ja_JP.UTF-8',
      PATH: '/usr/bin',
    });

    // Then: the inherited locale is preserved.
    expect(env['LANG']).toBe('ja_JP.UTF-8');
    expect(env['LC_CTYPE']).toBeUndefined();
  });

  it('strips LC_ALL=C so LANG can take effect on UTF-8 injection', () => {
    // Given: LC_ALL=C blocks LANG-based UTF-8 resolution.
    const env = buildPtyProcessEnv({
      LC_ALL: 'C',
      PATH: '/usr/bin',
    });

    // Then: LC_ALL is removed and UTF-8 defaults apply.
    expect(env['LC_ALL']).toBeUndefined();
    expect(env['LANG']).toMatch(/UTF-8/i);
  });

  it('applies caller extras after UTF-8 defaults so callers can override LANG', () => {
    // Given: optional pane-level env overrides.
    const env = buildPtyProcessEnv({ PATH: '/usr/bin' }, { LANG: 'ja_JP.UTF-8' });

    // Then: the explicit override wins.
    expect(env['LANG']).toBe('ja_JP.UTF-8');
  });

  it('treats a UTF-8 LC_ALL alone as sufficient and leaves LANG/LC_CTYPE alone', () => {
    // Given: only LC_ALL carries UTF-8; LANG and LC_CTYPE are absent.
    const env = buildPtyProcessEnv({
      LC_ALL: 'ja_JP.UTF-8',
      PATH: '/usr/bin',
    });

    // Then: no UTF-8 injection happens because LC_ALL already covers ctype.
    expect(env['LC_ALL']).toBe('ja_JP.UTF-8');
    expect(env['LANG']).toBeUndefined();
    expect(env['LC_CTYPE']).toBeUndefined();
  });

  it('preserves an existing LESSCHARSET instead of overwriting it', () => {
    // Given: a user who has explicitly chosen a less charset.
    const env = buildPtyProcessEnv({
      LANG: 'ja_JP.UTF-8',
      LESSCHARSET: 'iso8859',
      PATH: '/usr/bin',
    });

    // Then: their setting survives.
    expect(env['LESSCHARSET']).toBe('iso8859');
  });
});
