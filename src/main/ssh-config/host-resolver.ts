import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Function signature for executing a file.
 * Used for dependency injection in tests.
 */
export type SshExecFile = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Options for SshHostResolver.
 */
export interface SshHostResolverOptions {
  /**
   * Custom execFile implementation. Defaults to node:child_process.execFile.
   */
  execFile?: SshExecFile;
}

/**
 * Parses the output of `ssh -G <alias>`.
 *
 * Each line is typically in the format "directive value".
 * For directives that appear multiple times (e.g., 'identityfile'),
 * all values are collected into an array.
 *
 * @param stdout - The standard output from `ssh -G`.
 * @returns A record where keys are lowercase directives and values are arrays of strings.
 */
export function parseSshGOutput(stdout: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const [directive, ...valueParts] = trimmed.split(/\s+/);
    if (!directive) continue;

    // Keys are case-insensitive in SSH config, so we normalize to lowercase.
    const key = directive.toLowerCase();
    const value = valueParts.join(' ');

    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(value);
  }

  return result;
}

const defaultExecFile: SshExecFile = (file, args) => execFileAsync(file, args);

/**
 * Resolves SSH host configuration using the `ssh -G` command.
 *
 * This class provides a way to get the fully resolved configuration for an SSH alias,
 * accounting for wildcards, includes, and default values.
 *
 * Results are cached in an in-memory Map to avoid redundant process spawns.
 * The cache should be cleared when the underlying SSH config files might have changed.
 */
export class SshHostResolver {
  private cache = new Map<string, Record<string, string[]>>();
  private execFile: SshExecFile;
  private generation = 0;

  constructor(options: SshHostResolverOptions = {}) {
    this.execFile = options.execFile ?? defaultExecFile;
  }

  /**
   * Resolves the configuration for the given SSH alias.
   *
   * Behavior:
   * 1. Cache hit: Returns the cached Record immediately without spawning a process.
   * 2. Cache miss: Executes `ssh -G <alias>`, parses the output, and stores it in the cache.
   * 3. Error: If `execFile` rejects, the error is thrown and NOT cached. Subsequent calls
   *    will attempt to execute the command again.
   * 4. Concurrency: If multiple calls for the same alias occur simultaneously, they may
   *    each spawn their own process. This is accepted because resolution is typically
   *    triggered on-demand from UI interactions (e.g., expanding a host row), making
   *    collisions rare in practice.
   * 5. Cache invalidation: If `clear()` runs while `ssh -G` is still in flight, the
   *    late result is returned to that caller but is not written back into the cache.
   *
   * @param alias - The SSH host alias to resolve.
   * @returns A promise that resolves to the configuration record.
   * @throws Error if the `ssh` command fails.
   */
  async resolve(alias: string): Promise<Record<string, string[]>> {
    const cached = this.cache.get(alias);
    if (cached) {
      return cached;
    }

    const generationAtStart = this.generation;
    const { stdout } = await this.execFile('ssh', ['-G', alias]);
    const resolved = parseSshGOutput(stdout);
    if (generationAtStart === this.generation) {
      this.cache.set(alias, resolved);
    }
    return resolved;
  }

  /**
   * Clears the internal resolution cache.
   */
  clear(): void {
    this.generation += 1;
    this.cache.clear();
  }
}
