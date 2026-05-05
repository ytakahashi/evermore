import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SSHHost } from '../../shared/types';
import { parseSshConfig } from './parser';
import type { IncludedSshConfig, ParseSshConfigOptions } from './types';

export interface SshConfigDirectoryEntry {
  name: string;
  isDirectory: () => boolean;
}

export type SshConfigReadDirectory = (directoryPath: string) => SshConfigDirectoryEntry[];
export type SshConfigReadFile = (filePath: string) => string;
export type SshConfigParser = (text: string, options?: ParseSshConfigOptions) => SSHHost[];

export interface SshConfigManagerOptions {
  getConfigPath?: () => string;
  readDirectory?: SshConfigReadDirectory;
  readFile?: SshConfigReadFile;
  parse?: SshConfigParser;
}

interface FileSystemError extends Error {
  code?: string;
}

function isFileSystemError(error: unknown): error is FileSystemError {
  return error instanceof Error && 'code' in error;
}

function isMissingFileError(error: unknown): boolean {
  return isFileSystemError(error) && error.code === 'ENOENT';
}

function defaultReadFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function defaultReadDirectory(directoryPath: string): SshConfigDirectoryEntry[] {
  return fs.readdirSync(directoryPath, { withFileTypes: true });
}

function defaultConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

function expandHomePrefix(filePath: string): string {
  if (filePath === '~') {
    return os.homedir();
  }

  if (filePath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), filePath.slice(2));
  }

  return filePath;
}

function hasGlobChars(segment: string): boolean {
  return /[*?]/.test(segment);
}

function escapeRegExp(text: string): string {
  return text.replace(/[\\^$+?.()|{}[\]]/g, '\\$&');
}

// Mirrors OpenSSH's fnmatch-based Include matching: `*` and `?` cross
// path separators only via the segment boundary, and leading-dot files
// are intentionally NOT excluded (OpenSSH calls `fnmatch` with flag 0,
// so `Include conf.d/*` matches `.disabled` too).
function globSegmentToRegExp(segment: string): RegExp {
  const source = segment
    .split('')
    .map((char) => {
      if (char === '*') {
        return '[^/]*';
      }
      if (char === '?') {
        return '[^/]';
      }
      return escapeRegExp(char);
    })
    .join('');

  return new RegExp(`^${source}$`);
}

function safeReadDir(
  directoryPath: string,
  readDirectory: SshConfigReadDirectory,
): SshConfigDirectoryEntry[] {
  try {
    return readDirectory(directoryPath);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function splitPattern(filePath: string): { root: string; segments: string[] } {
  const normalizedPath = normalizePath(expandHomePrefix(filePath));
  const parsedPath = path.parse(normalizedPath);
  const relativePath = normalizedPath.slice(parsedPath.root.length);

  return {
    root: parsedPath.root,
    segments: relativePath.split(path.sep).filter(Boolean),
  };
}

function expandGlobPattern(pattern: string, readDirectory: SshConfigReadDirectory): string[] {
  const { root, segments } = splitPattern(pattern);

  function walk(currentPath: string, remainingSegments: string[]): string[] {
    const [segment, ...rest] = remainingSegments;
    if (segment === undefined) {
      return [currentPath];
    }

    if (!hasGlobChars(segment)) {
      return walk(path.join(currentPath, segment), rest);
    }

    const matcher = globSegmentToRegExp(segment);
    return safeReadDir(currentPath, readDirectory)
      .filter((entry) => matcher.test(entry.name))
      .filter((entry) => (rest.length === 0 ? !entry.isDirectory() : entry.isDirectory()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => walk(path.join(currentPath, entry.name), rest));
  }

  return walk(root, segments);
}

function expandIncludePath(includePath: string, readDirectory: SshConfigReadDirectory): string[] {
  const normalizedPath = normalizePath(expandHomePrefix(includePath));
  if (!normalizedPath.split(path.sep).some(hasGlobChars)) {
    return [normalizedPath];
  }

  return expandGlobPattern(normalizedPath, readDirectory);
}

/**
 * Reads OpenSSH config files and caches the parsed host list for renderer IPC callers.
 */
export class SshConfigManager {
  private readonly getConfigPath: () => string;
  private readonly parse: SshConfigParser;
  private readonly readDirectory: SshConfigReadDirectory;
  private readonly readFile: SshConfigReadFile;
  private cachedHosts: SSHHost[] | null;

  public constructor(options: SshConfigManagerOptions = {}) {
    this.getConfigPath = options.getConfigPath ?? defaultConfigPath;
    this.readDirectory = options.readDirectory ?? defaultReadDirectory;
    this.readFile = options.readFile ?? defaultReadFile;
    this.parse = options.parse ?? parseSshConfig;
    this.cachedHosts = null;
  }

  /**
   * Returns cached SSH hosts, parsing `~/.ssh/config` on the first call.
   */
  public list(): SSHHost[] {
    if (this.cachedHosts !== null) {
      return this.cachedHosts;
    }

    this.cachedHosts = this.readAndParse();
    return this.cachedHosts;
  }

  /**
   * Clears the cache and reparses the current config immediately.
   */
  public refresh(): SSHHost[] {
    this.cachedHosts = null;
    return this.list();
  }

  private readAndParse(): SSHHost[] {
    const sourcePath = normalizePath(this.getConfigPath());
    const sshDirectory = path.dirname(sourcePath);

    let text: string;
    try {
      text = this.readFile(sourcePath);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    // Keep parsing synchronous: parser unit tests and responsibilities stay small, recursive
    // Include expansion remains a natural parser callback, and SSH config files are small enough
    // that synchronous main-process reads are acceptable for this explicit user action.
    return this.parse(text, {
      sourcePath,
      sshDirectory,
      includeResolver: (includePath): IncludedSshConfig[] =>
        expandIncludePath(includePath, this.readDirectory).flatMap((filePath) => {
          try {
            return [{ path: filePath, text: this.readFile(filePath) }];
          } catch (error: unknown) {
            if (isMissingFileError(error)) {
              return [];
            }
            throw error;
          }
        }),
    });
  }
}
