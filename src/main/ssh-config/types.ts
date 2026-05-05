import type { ForwardEntry, SSHHost } from '../../shared/types';

/**
 * A single config document supplied by an {@link SshConfigIncludeResolver}.
 * `path` is the absolute path used for cycle detection, `text` is the file
 * contents that the parser will recurse into.
 */
export interface IncludedSshConfig {
  path: string;
  text: string;
}

/**
 * Contextual information passed to an {@link SshConfigIncludeResolver} so it
 * can resolve relative includes consistently with OpenSSH semantics.
 *
 * - `currentPath` is the absolute path of the file that contains the
 *   `Include` directive.
 * - `sshDirectory` is the user's `~/.ssh` directory; per OpenSSH, relative
 *   include paths are resolved against this directory regardless of which
 *   file the `Include` appears in.
 */
export interface SshConfigIncludeContext {
  currentPath: string;
  sshDirectory: string;
}

/**
 * Resolver invoked for every `Include` directive encountered while parsing.
 *
 * Contract:
 * - The parser passes a partially-resolved path: absolute paths are kept
 *   as-is, plain relative paths are joined with `sshDirectory`, and
 *   tilde-prefixed paths (e.g. `~/foo`) are forwarded untouched so the
 *   resolver can perform OpenSSH-compatible home expansion.
 * - The resolver owns the remaining normalization steps the caller cares
 *   about: tilde expansion, glob expansion (`conf.d/*`), and any I/O.
 * - Returning multiple {@link IncludedSshConfig} entries lets the resolver
 *   expand a single `Include` directive into many files.
 * - On I/O failure or when no files match, return an empty array; the
 *   parser will treat the include as a no-op rather than throwing.
 * - Each returned `path` participates in cycle detection. Already-visited
 *   paths are silently skipped.
 */
export type SshConfigIncludeResolver = (
  includePath: string,
  context: SshConfigIncludeContext,
) => IncludedSshConfig[];

/**
 * Options accepted by {@link parseSshConfig}.
 *
 * - `sourcePath` is the absolute path the input text originated from. It is
 *   used as the cycle-detection key for the root document and defaults to
 *   `~/.ssh/config`.
 * - `sshDirectory` overrides the directory used to resolve relative
 *   `Include` paths. Defaults to `path.dirname(sourcePath)`.
 * - `includeResolver` is required to follow `Include` directives. When
 *   omitted, includes are silently skipped (useful for unit tests that only
 *   care about a single document).
 */
export interface ParseSshConfigOptions {
  sourcePath?: string;
  sshDirectory?: string;
  includeResolver?: SshConfigIncludeResolver;
}

/**
 * Intermediate representation of a single Host block extracted from the
 * `ssh-config` AST before it is normalized into one or more {@link SSHHost}
 * records (one per alias).
 */
export interface ParsedHostBlock {
  aliases: string[];
  directives: Record<string, string[]>;
}

/** Re-export of {@link SSHHost} for callers that work with parser output. */
export type ParsedSshHost = SSHHost;

/** Re-export of {@link ForwardEntry} for callers that work with parser output. */
export type ParsedForwardEntry = ForwardEntry;
