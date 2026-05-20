/**
 * Integration test for the ZDOTDIR-based shell-integration injector.
 *
 * Unit tests in `src/main/shell-integration/injector.test.ts` cover envExtras shape and idempotency
 * with mocks. This suite combines the real `ShellIntegrationInjector` with the real
 * `forwarding-scripts` builders and a real temp filesystem, then asserts the structural invariants
 * the design doc relies on (user rc temporarily restored, Evermore ZDOTDIR re-applied after each
 * source, snippet sourced from .zshrc, final cleanup at the end of the chain).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShellIntegrationInjector } from '../../src/main/shell-integration/injector';

describe('ShellIntegrationInjector (integration)', () => {
  let userDataDir: string;
  let zdotdir: string;
  let injector: ShellIntegrationInjector;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), 'evermore-shell-inject-integration-'));
    injector = new ShellIntegrationInjector({
      userDataDir,
      initialAutoInject: true,
    });
    zdotdir = injector.getDirectory();
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it('materializes forwarding scripts that source user rc and restore ZDOTDIR', () => {
    // Given: a materialized ZDOTDIR.

    // When: the four forwarding files are read back from disk.
    const zshenv = readFileSync(path.join(zdotdir, '.zshenv'), 'utf8');
    const zprofile = readFileSync(path.join(zdotdir, '.zprofile'), 'utf8');
    const zshrc = readFileSync(path.join(zdotdir, '.zshrc'), 'utf8');
    const zlogin = readFileSync(path.join(zdotdir, '.zlogin'), 'utf8');

    // Then: .zshenv defines both helpers required by the rest of the chain and seeds the
    // user-visible ZDOTDIR state from EVERMORE_ORIGINAL_ZDOTDIR_SET.
    expect(zshenv).toContain('_evermore_source_user_rc()');
    expect(zshenv).toContain('_evermore_finalize_zdotdir()');
    expect(zshenv).toContain('EVERMORE_ORIGINAL_ZDOTDIR_SET');
    expect(zshenv).toContain('_evermore_source_user_rc .zshenv');

    // And: every script that sources a user rc uses the shared helper (which restores ZDOTDIR to
    // $EVERMORE_INJECT_ZDOTDIR after the source completes) instead of inlining the dot-source.
    expect(zprofile).toContain('_evermore_source_user_rc .zprofile');
    expect(zshrc).toContain('_evermore_source_user_rc .zshrc');
    expect(zlogin).toContain('_evermore_source_user_rc .zlogin');

    // And: the snippet is only sourced from .zshrc (interactive-shell hooks need it), not from
    // the non-interactive startup files.
    expect(zshrc).toContain('"$EVERMORE_INJECT_ZDOTDIR/evermore-shell-integration.zsh"');
    expect(zshenv).not.toContain('evermore-shell-integration.zsh');
    expect(zprofile).not.toContain('evermore-shell-integration.zsh');
    expect(zlogin).not.toContain('evermore-shell-integration.zsh');

    // And: the final user-visible ZDOTDIR restore + env cleanup runs from .zlogin (login shells)
    // and conditionally from .zshrc (non-login interactive shells).
    expect(zlogin).toContain('_evermore_finalize_zdotdir');
    expect(zshrc).toContain('if [[ ! -o login ]]; then');
    expect(zshrc).toContain('_evermore_finalize_zdotdir');
  });

  it('keeps ZDOTDIR pointing at the Evermore directory between user rc sources', () => {
    // Given: the .zshenv helper body.
    const zshenv = readFileSync(path.join(zdotdir, '.zshenv'), 'utf8');

    // Then: every successful source path inside the helper ends with the Evermore ZDOTDIR being
    // reasserted. This is the invariant that lets zsh continue to find the next forwarding file
    // (.zprofile / .zshrc / .zlogin) inside the Evermore directory rather than the user's home.
    expect(zshenv).toMatch(/export ZDOTDIR="\$EVERMORE_INJECT_ZDOTDIR"/);
    // And: while sourcing a user rc, ZDOTDIR is temporarily set to the user-visible value so the
    // user rc sees its own expected ZDOTDIR (or unset when none was originally set).
    expect(zshenv).toMatch(/export ZDOTDIR="\$__evermore_user_zdotdir"/);
    expect(zshenv).toMatch(/unset ZDOTDIR/);
  });

  it('unsets all auto-injection state in the final cleanup so subshells stay clean', () => {
    // Given: the .zshenv helper body where the cleanup function is defined.
    const zshenv = readFileSync(path.join(zdotdir, '.zshenv'), 'utf8');

    // Then: every Evermore-owned env name plus the internal __evermore_* state is unset, so a
    // subshell started inside the Evermore PTY does not inherit the injection.
    expect(zshenv).toContain(
      'unset EVERMORE_INJECT_ZDOTDIR EVERMORE_ORIGINAL_ZDOTDIR_SET EVERMORE_ORIGINAL_ZDOTDIR',
    );
    expect(zshenv).toContain('unset __evermore_user_zdotdir_set __evermore_user_zdotdir');
    expect(zshenv).toContain('unset -f _evermore_source_user_rc _evermore_finalize_zdotdir');
  });

  it('captures the original ZDOTDIR from baseEnv so the helper can restore it later', () => {
    // Given: a baseEnv as if the user had `ZDOTDIR=$HOME/.config/zsh` exported pre-launch.

    // When: env extras are computed.
    const extras = injector.envExtrasForShell('/bin/zsh', {
      ZDOTDIR: '/Users/tester/.config/zsh',
    });

    // Then: the extras hand the original value to the forwarding helpers via the two
    // EVERMORE_ORIGINAL_ZDOTDIR* variables, while ZDOTDIR itself is rerouted to the Evermore dir.
    expect(extras).toEqual({
      ZDOTDIR: zdotdir,
      EVERMORE_INJECT_ZDOTDIR: zdotdir,
      EVERMORE_ORIGINAL_ZDOTDIR_SET: '1',
      EVERMORE_ORIGINAL_ZDOTDIR: '/Users/tester/.config/zsh',
    });
  });

  it('records the absence of ZDOTDIR so the helper sources user rc from $HOME', () => {
    // Given: a baseEnv with no ZDOTDIR at all (the common case on macOS).

    // When: env extras are computed.
    const extras = injector.envExtrasForShell('/bin/zsh', { PATH: '/usr/bin' });

    // Then: EVERMORE_ORIGINAL_ZDOTDIR_SET=0 tells the helper to `unset ZDOTDIR` while sourcing,
    // so user rc lookup falls through to $HOME via `${ZDOTDIR:-$HOME}`.
    expect(extras?.EVERMORE_ORIGINAL_ZDOTDIR_SET).toBe('0');
    expect(extras?.EVERMORE_ORIGINAL_ZDOTDIR).toBe('');
  });
});
