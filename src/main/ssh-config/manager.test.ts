import { describe, expect, it, vi } from 'vitest';
import type { SSHHost } from '../../shared/types';
import type { SshConfigDirectoryEntry } from './manager';
import { SshConfigManager } from './manager';
import type { ParseSshConfigOptions } from './types';

const HOSTS: SSHHost[] = [
  {
    alias: 'dev',
    hostname: 'dev.example.com',
    hasForwarding: true,
    forwards: [
      {
        type: 'local',
        bindPort: 5433,
        hostAddress: 'localhost',
        hostPort: 5432,
      },
    ],
  },
];

function createMissingFileError(): NodeJS.ErrnoException {
  const error = new Error('missing') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  return error;
}

function directoryEntry(name: string, isDirectory = false): SshConfigDirectoryEntry {
  return {
    name,
    isDirectory: () => isDirectory,
  };
}

describe('SshConfigManager', () => {
  it('reads the root config and returns parser output', () => {
    // Given: a manager with injected config I/O and parser dependencies.
    const readFile = vi.fn((filePath: string) => {
      expect(filePath).toBe('/Users/tester/.ssh/config');
      return 'Host dev';
    });
    const parse = vi.fn((_text: string, _options?: ParseSshConfigOptions) => HOSTS);
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readFile,
      parse,
    });

    // When: hosts are listed.
    const hosts = manager.list();

    // Then: the parsed host records, including forwarding metadata, are returned unchanged.
    expect(hosts).toBe(HOSTS);
    expect(hosts[0]?.hasForwarding).toBe(true);
    expect(hosts[0]?.forwards).toHaveLength(1);
    expect(readFile).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledWith(
      'Host dev',
      expect.objectContaining({
        sourcePath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
        includeResolver: expect.any(Function),
      }),
    );
  });

  it('caches list results until refresh is called', () => {
    // Given: the underlying config content changes between reads.
    const readFile = vi.fn(() => 'Host dev');
    const parse = vi
      .fn<(text: string, options?: ParseSshConfigOptions) => SSHHost[]>()
      .mockReturnValueOnce(HOSTS)
      .mockReturnValueOnce([]);
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readFile,
      parse,
    });

    // When: list is called twice, then refresh is called.
    const first = manager.list();
    const second = manager.list();
    const refreshed = manager.refresh();

    // Then: list uses the cache, while refresh forces a reparse.
    expect(first).toBe(HOSTS);
    expect(second).toBe(HOSTS);
    expect(refreshed).toEqual([]);
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list when the root config is missing', () => {
    // Given: no ~/.ssh/config exists.
    const readFile = vi.fn(() => {
      throw createMissingFileError();
    });
    const parse = vi.fn((_text: string, _options?: ParseSshConfigOptions) => HOSTS);
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readFile,
      parse,
    });

    // When: hosts are listed.
    const hosts = manager.list();

    // Then: missing config is treated as no configured hosts.
    expect(hosts).toEqual([]);
    expect(parse).not.toHaveBeenCalled();
  });

  it('lets parser Include callbacks read additional config files', () => {
    // Given: the parser follows an Include through the manager-provided resolver.
    const files = new Map([
      ['/Users/tester/.ssh/config', 'Include conf.d/*'],
      ['/Users/tester/.ssh/conf.d/a.conf', 'Host included-a'],
      ['/Users/tester/.ssh/conf.d/b.conf', 'Host included-b'],
    ]);
    const readFile = vi.fn((filePath: string) => {
      const text = files.get(filePath);
      if (text === undefined) {
        throw createMissingFileError();
      }
      return text;
    });
    const readDirectory = vi.fn((directoryPath: string) => {
      expect(directoryPath).toBe('/Users/tester/.ssh/conf.d');
      // The 'nested' subdirectory should be excluded from a final-segment glob,
      // matching OpenSSH's file-only Include semantics.
      return [directoryEntry('b.conf'), directoryEntry('a.conf'), directoryEntry('nested', true)];
    });
    const parse = vi.fn((_text: string, options?: ParseSshConfigOptions) => {
      const included = options?.includeResolver?.('/Users/tester/.ssh/conf.d/*', {
        currentPath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
      });

      expect(included).toEqual([
        { path: '/Users/tester/.ssh/conf.d/a.conf', text: 'Host included-a' },
        { path: '/Users/tester/.ssh/conf.d/b.conf', text: 'Host included-b' },
      ]);
      return HOSTS;
    });
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readDirectory,
      readFile,
      parse,
    });

    // When: hosts are listed.
    const hosts = manager.list();

    // Then: include files are supplied to the parser resolver.
    expect(hosts).toBe(HOSTS);
    expect(readFile).toHaveBeenCalledWith('/Users/tester/.ssh/conf.d/a.conf');
    expect(readFile).toHaveBeenCalledWith('/Users/tester/.ssh/conf.d/b.conf');
  });

  it('treats a missing include file as a no-op', () => {
    // Given: the parser asks the resolver for an include file that does not exist.
    const readFile = vi.fn((filePath: string) => {
      if (filePath === '/Users/tester/.ssh/config') {
        return 'Include missing';
      }
      throw createMissingFileError();
    });
    const parse = vi.fn((_text: string, options?: ParseSshConfigOptions) => {
      const result = options?.includeResolver?.('/Users/tester/.ssh/missing', {
        currentPath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
      });

      expect(result).toEqual([]);
      return HOSTS;
    });
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readFile,
      parse,
    });

    // When: hosts are listed.
    const hosts = manager.list();

    // Then: the missing include yields nothing rather than throwing.
    expect(hosts).toBe(HOSTS);
  });

  it('rethrows non-ENOENT include errors so callers can surface real failures', () => {
    // Given: the include file exists but is unreadable due to permissions.
    const permissionError = new Error('permission denied') as NodeJS.ErrnoException;
    permissionError.code = 'EACCES';
    const readFile = vi.fn((filePath: string) => {
      if (filePath === '/Users/tester/.ssh/config') {
        return 'Include unreadable';
      }
      throw permissionError;
    });
    const parse = vi.fn((_text: string, options?: ParseSshConfigOptions) => {
      options?.includeResolver?.('/Users/tester/.ssh/unreadable', {
        currentPath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
      });
      return HOSTS;
    });
    const manager = new SshConfigManager({
      getConfigPath: () => '/Users/tester/.ssh/config',
      readFile,
      parse,
    });

    // When / Then: the EACCES propagates to the caller instead of being swallowed.
    expect(() => manager.list()).toThrow(permissionError);
  });
});
