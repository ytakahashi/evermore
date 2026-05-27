import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from '../../shared/shell-integration/zsh-snippet';
import { createLogger, type LogRecord, type LogTransport } from '../logging/logger';
import { buildZlogin, buildZprofile, buildZshenv, buildZshrc } from './forwarding-scripts';
import {
  ShellIntegrationInjector,
  type ShellIntegrationInjectorFs,
  type ShellIntegrationInjectorOptions,
} from './injector';

function createInjector(overrides: Partial<ShellIntegrationInjectorOptions> = {}): {
  injector: ShellIntegrationInjector;
  userDataDir: string;
  cleanup: () => void;
} {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'evermore-shell-inject-'));
  const injector = new ShellIntegrationInjector({
    userDataDir,
    initialAutoInject: true,
    ...overrides,
  });
  return {
    injector,
    userDataDir,
    cleanup: () => {
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

describe('ShellIntegrationInjector', () => {
  let cleanups: Array<() => void>;

  beforeEach(() => {
    cleanups = [];
  });

  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    vi.restoreAllMocks();
  });

  describe('envExtrasForShell', () => {
    it('returns the ZDOTDIR injection set for a zsh shell when auto-inject is on', () => {
      // Given: an injector materialized with auto-inject ON.
      const { injector, userDataDir, cleanup } = createInjector();
      cleanups.push(cleanup);

      // When: env extras are requested for a zsh shell with no pre-existing ZDOTDIR.
      const extras = injector.envExtrasForShell('/bin/zsh', { PATH: '/usr/bin' });

      // Then: the four injection keys point to the materialized ZDOTDIR and record the absence
      // of an original ZDOTDIR so the forwarding script knows to source from $HOME.
      expect(extras).toEqual({
        ZDOTDIR: path.join(userDataDir, 'shell-integration', 'zsh'),
        EVERMORE_INJECT_ZDOTDIR: path.join(userDataDir, 'shell-integration', 'zsh'),
        EVERMORE_ORIGINAL_ZDOTDIR_SET: '0',
        EVERMORE_ORIGINAL_ZDOTDIR: '',
      });
    });

    it('captures the user-set ZDOTDIR from baseEnv so the forwarding script can restore it', () => {
      // Given: the user runs zsh with `ZDOTDIR=$HOME/.config/zsh` already exported.
      const { injector, cleanup } = createInjector();
      cleanups.push(cleanup);

      // When: env extras are requested with that base env.
      const extras = injector.envExtrasForShell('/bin/zsh', {
        ZDOTDIR: '/Users/tester/.config/zsh',
      });

      // Then: the original ZDOTDIR is preserved verbatim so user rc lookup keeps working.
      expect(extras?.EVERMORE_ORIGINAL_ZDOTDIR_SET).toBe('1');
      expect(extras?.EVERMORE_ORIGINAL_ZDOTDIR).toBe('/Users/tester/.config/zsh');
    });

    it.each(['/bin/zsh', 'zsh', '-zsh'])('accepts %s as a zsh shell path', (shellPath) => {
      // Given: a healthy injector.
      const { injector, cleanup } = createInjector();
      cleanups.push(cleanup);

      // When / Then: the shell-name variant is treated as zsh.
      expect(injector.envExtrasForShell(shellPath, {})).toBeDefined();
    });

    it.each(['/bin/bash', '/usr/local/bin/fish', '/bin/sh', '/usr/bin/dash'])(
      'returns undefined for non-zsh shell %s',
      (shellPath) => {
        // Given: a healthy injector.
        const { injector, cleanup } = createInjector();
        cleanups.push(cleanup);

        // When / Then: non-zsh shells skip auto-injection entirely.
        expect(injector.envExtrasForShell(shellPath, {})).toBeUndefined();
      },
    );

    it('returns undefined when auto-inject is off', () => {
      // Given: an injector with auto-inject OFF.
      const { injector, cleanup } = createInjector({ initialAutoInject: false });
      cleanups.push(cleanup);

      // When / Then: even zsh shells get no extras.
      expect(injector.envExtrasForShell('/bin/zsh', {})).toBeUndefined();
    });
  });

  describe('materialize', () => {
    it('writes the four forwarding scripts and the snippet into the ZDOTDIR', () => {
      // Given: a fresh injector with auto-inject ON.
      const { userDataDir, cleanup } = createInjector();
      cleanups.push(cleanup);
      const zdotdir = path.join(userDataDir, 'shell-integration', 'zsh');

      // Then: every expected file exists with the builder-produced content.
      expect(readFileSync(path.join(zdotdir, '.zshenv'), 'utf8')).toBe(buildZshenv());
      expect(readFileSync(path.join(zdotdir, '.zprofile'), 'utf8')).toBe(buildZprofile());
      expect(readFileSync(path.join(zdotdir, '.zshrc'), 'utf8')).toBe(buildZshrc());
      expect(readFileSync(path.join(zdotdir, '.zlogin'), 'utf8')).toBe(buildZlogin());
      expect(readFileSync(path.join(zdotdir, 'evermore-shell-integration.zsh'), 'utf8')).toBe(
        EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
      );
    });

    it('does not materialize anything when initialAutoInject is false', () => {
      // Given: the user has shellIntegration.autoInject disabled at startup.
      const { userDataDir, cleanup } = createInjector({ initialAutoInject: false });
      cleanups.push(cleanup);
      const zdotdir = path.join(userDataDir, 'shell-integration', 'zsh');

      // Then: no forwarding scripts are written.
      expect(existsSync(zdotdir)).toBe(false);
    });

    it('is idempotent: re-materializing with unchanged content does not rewrite files', () => {
      // Given: a materialized injector and recorded mtimes.
      const { injector, userDataDir, cleanup } = createInjector();
      cleanups.push(cleanup);
      const zdotdir = path.join(userDataDir, 'shell-integration', 'zsh');
      const targets = [
        '.zshenv',
        '.zprofile',
        '.zshrc',
        '.zlogin',
        'evermore-shell-integration.zsh',
      ];
      const beforeMtimes = targets.map((name) => statSync(path.join(zdotdir, name)).mtimeMs);

      // When: auto-inject is toggled OFF then ON to force a re-materialize.
      injector.setAutoInject(false);
      injector.setAutoInject(true);

      // Then: every file's mtime is unchanged because content matched.
      const afterMtimes = targets.map((name) => statSync(path.join(zdotdir, name)).mtimeMs);
      expect(afterMtimes).toEqual(beforeMtimes);
    });

    it('falls back silently when filesystem writes throw', () => {
      // Given: a failing fs adapter and a recording logger.
      const records: LogRecord[] = [];
      const transport: LogTransport = {
        write(record) {
          records.push(record);
        },
      };
      const logger = createLogger({ level: 'debug', transport });
      const failingFs: ShellIntegrationInjectorFs = {
        mkdirSync: () => {
          throw new Error('EACCES');
        },
        writeFileSync: () => {
          throw new Error('should not reach');
        },
        readFileSync: () => {
          throw new Error('should not reach');
        },
      };

      // When: the injector is constructed with auto-inject ON but failing fs.
      const injector = new ShellIntegrationInjector({
        userDataDir: '/nonexistent',
        initialAutoInject: true,
        fs: failingFs,
        logger,
      });

      // Then: env extras are undefined so PTY spawn falls back gracefully, and the failure is
      // routed through the injected logger rather than console.
      expect(injector.envExtrasForShell('/bin/zsh', {})).toBeUndefined();
      expect(records).toEqual([
        expect.objectContaining({
          level: 'error',
          message: 'ShellIntegrationInjector.materialize failed',
        }),
      ]);
    });
  });

  describe('setAutoInject', () => {
    it('stops returning env extras after toggling off', () => {
      // Given: an injector starting in the ON state.
      const { injector, cleanup } = createInjector();
      cleanups.push(cleanup);
      expect(injector.envExtrasForShell('/bin/zsh', {})).toBeDefined();

      // When: settings flip auto-inject off.
      injector.setAutoInject(false);

      // Then: subsequent env-extras requests return undefined.
      expect(injector.envExtrasForShell('/bin/zsh', {})).toBeUndefined();
    });

    it('re-materializes on OFF -> ON so a deleted ZDOTDIR recovers', () => {
      // Given: a materialized injector that then has its directory wiped out of band.
      const { injector, userDataDir, cleanup } = createInjector();
      cleanups.push(cleanup);
      const zdotdir = path.join(userDataDir, 'shell-integration', 'zsh');
      rmSync(zdotdir, { recursive: true, force: true });
      injector.setAutoInject(false);

      // When: the user toggles auto-inject back on.
      injector.setAutoInject(true);

      // Then: the forwarding scripts exist again.
      expect(existsSync(path.join(zdotdir, '.zshrc'))).toBe(true);
      expect(injector.envExtrasForShell('/bin/zsh', {})).toBeDefined();
    });

    it('is a no-op when the requested state matches the current state', () => {
      // Given: an injector with a tracked writeFileSync.
      const realFs = {
        mkdirSync,
        writeFileSync: vi.fn(),
        readFileSync,
      } satisfies ShellIntegrationInjectorFs;
      const userDataDir = mkdtempSync(path.join(tmpdir(), 'evermore-shell-inject-'));
      cleanups.push(() => rmSync(userDataDir, { recursive: true, force: true }));
      // Initial construction with the spy attached so we can measure subsequent setAutoInject calls.
      const injector = new ShellIntegrationInjector({
        userDataDir,
        initialAutoInject: true,
        fs: realFs,
      });
      const writesAfterConstruction = realFs.writeFileSync.mock.calls.length;

      // When: setAutoInject is called with the same value.
      injector.setAutoInject(true);

      // Then: no additional file writes happen.
      expect(realFs.writeFileSync.mock.calls.length).toBe(writesAfterConstruction);
    });
  });
});
