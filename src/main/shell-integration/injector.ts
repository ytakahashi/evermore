import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from '../../shared/shell-integration/zsh-snippet';
import { createSilentLogger, type Logger } from '../logging/logger';
import { buildZlogin, buildZprofile, buildZshenv, buildZshrc } from './forwarding-scripts';

/**
 * Filesystem operations the injector relies on. Production wires real `node:fs` functions;
 * tests inject a temp-directory-backed adapter.
 */
export interface ShellIntegrationInjectorFs {
  mkdirSync: (target: string, options: { recursive: true }) => unknown;
  writeFileSync: (target: string, content: string, encoding: 'utf8') => void;
  readFileSync: (target: string, encoding: 'utf8') => string;
}

export interface ShellIntegrationInjectorOptions {
  /** Evermore userData root; the injector writes forwarding scripts under `shell-integration/zsh/`. */
  userDataDir: string;
  /** Initial value of `shellIntegration.autoInject` from `SettingsStore`. */
  initialAutoInject: boolean;
  /** Snippet body to materialize. Production passes the shared zsh snippet; tests pass fixtures. */
  snippet?: string;
  /** Filesystem adapter (DI). Production uses real `node:fs`. */
  fs?: ShellIntegrationInjectorFs;
  /**
   * Logger for materialize failures. Optional so tests can omit it and inherit a silent default;
   * production wiring injects a scoped logger from the composition root.
   */
  logger?: Logger;
}

const ENV_KEY_ZDOTDIR = 'ZDOTDIR' as const;
const ENV_KEY_INJECT_ZDOTDIR = 'EVERMORE_INJECT_ZDOTDIR' as const;
const ENV_KEY_ORIGINAL_SET = 'EVERMORE_ORIGINAL_ZDOTDIR_SET' as const;
const ENV_KEY_ORIGINAL = 'EVERMORE_ORIGINAL_ZDOTDIR' as const;

/**
 * Materializes Evermore-managed zsh forwarding scripts and produces the `ZDOTDIR`-based env
 * extras that `PtyManager.create()` merges into the PTY's environment when auto-injection is on.
 *
 * Lifecycle:
 *  - Constructed once per app run with the persisted `autoInject` value. If ON, the constructor
 *    materializes the forwarding scripts immediately so the first PTY spawn does not race.
 *  - `setAutoInject(true)` re-materializes (idempotent — content-compared per file) so a toggle
 *    OFF → ON recovers from any external deletion of the directory.
 *  - `envExtrasForShell` returns the env keys to inject when the target shell is zsh **and**
 *    auto-injection is on **and** the forwarding scripts are present on disk; otherwise returns
 *    `undefined` and PTY spawn falls back to the Phase 3 manual snippet path.
 *
 * Failure policy: the injector never throws to the caller. Filesystem errors are logged and the
 * injector enters a "skipped" state until the next `setAutoInject(true)` retry, at which point
 * materialization is attempted again.
 */
export class ShellIntegrationInjector {
  private readonly directory: string;
  private readonly snippet: string;
  private readonly fs: ShellIntegrationInjectorFs;
  private readonly logger: Logger;
  private autoInject: boolean;
  private materializeOk = false;

  public constructor(options: ShellIntegrationInjectorOptions) {
    this.directory = path.join(options.userDataDir, 'shell-integration', 'zsh');
    this.snippet = options.snippet ?? EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET;
    this.fs = options.fs ?? {
      mkdirSync,
      writeFileSync,
      readFileSync,
    };
    this.logger = options.logger ?? createSilentLogger();
    this.autoInject = options.initialAutoInject;
    if (this.autoInject) {
      this.materialize();
    }
  }

  /**
   * Returns the env keys to inject when spawning a PTY, or `undefined` to skip injection.
   *
   * `baseEnv` is the pre-injection env (pane-level overrides already merged on top of
   * `process.env`). Reading `ZDOTDIR` from this merged view ensures that a pane-level
   * `options.env.ZDOTDIR` is treated as the user's original value.
   */
  public envExtrasForShell(
    shell: string,
    baseEnv: NodeJS.ProcessEnv,
  ): Record<string, string> | undefined {
    if (!this.autoInject) {
      return undefined;
    }
    if (!isZshShell(shell)) {
      return undefined;
    }
    if (!this.materializeOk) {
      return undefined;
    }

    const originalZdotdir = baseEnv[ENV_KEY_ZDOTDIR];
    return {
      [ENV_KEY_ZDOTDIR]: this.directory,
      [ENV_KEY_INJECT_ZDOTDIR]: this.directory,
      [ENV_KEY_ORIGINAL_SET]: originalZdotdir === undefined ? '0' : '1',
      [ENV_KEY_ORIGINAL]: originalZdotdir ?? '',
    };
  }

  /**
   * Applies a settings change. Going OFF stops returning env extras starting from the next PTY
   * spawn; existing PTYs retain their injected env (this is intentional — see the design doc).
   * Going ON re-materializes so a stale directory recovers automatically.
   */
  public setAutoInject(enabled: boolean): void {
    if (enabled === this.autoInject) {
      return;
    }
    this.autoInject = enabled;
    if (enabled) {
      this.materialize();
    }
  }

  /** Absolute path to the Evermore-managed ZDOTDIR. Exposed for tests and diagnostics. */
  public getDirectory(): string {
    return this.directory;
  }

  private materialize(): void {
    try {
      this.fs.mkdirSync(this.directory, { recursive: true });
      const files: ReadonlyArray<readonly [string, string]> = [
        ['.zshenv', buildZshenv()],
        ['.zprofile', buildZprofile()],
        ['.zshrc', buildZshrc()],
        ['.zlogin', buildZlogin()],
        ['evermore-shell-integration.zsh', this.snippet],
      ];
      for (const [name, content] of files) {
        const target = path.join(this.directory, name);
        // Skip writes when the on-disk content already matches so subsequent app runs do not bump
        // mtimes — keeping zsh startup cost stable across launches.
        if (!this.contentMatches(target, content)) {
          this.fs.writeFileSync(target, content, 'utf8');
        }
      }
      this.materializeOk = true;
    } catch (error: unknown) {
      // Auto-injection is best-effort. If the userData directory is unwritable or fs is in an
      // unusual state, leave `materializeOk = false` so `envExtrasForShell` returns undefined and
      // PTY spawn continues without auto-injection.
      this.materializeOk = false;
      this.logger.error('ShellIntegrationInjector.materialize failed', error);
    }
  }

  private contentMatches(filePath: string, expected: string): boolean {
    try {
      return this.fs.readFileSync(filePath, 'utf8') === expected;
    } catch {
      return false;
    }
  }
}

function isZshShell(shellPath: string): boolean {
  // `shellPath` may be `/bin/zsh`, `zsh`, or `-zsh` (the latter is the argv[0] convention some
  // login shells use). Match the basename plus the login-marker variant.
  const base = path.basename(shellPath);
  return base === 'zsh' || base === '-zsh';
}
