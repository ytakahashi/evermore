import { describe, expect, it } from 'vitest';
import { parseSshConfig } from './parser';
import type { IncludedSshConfig, SshConfigIncludeContext } from './types';

describe('parseSshConfig', () => {
  it('parses host directives and expands multiple aliases', () => {
    // Given: one Host block declares two concrete aliases.
    const text = `
Host dev api
  HostName dev.example.com
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: each alias becomes an SSHHost with the shared directives.
    expect(hosts).toEqual([
      {
        alias: 'dev',
        hostname: 'dev.example.com',
        user: 'deploy',
        port: 2222,
        identityFile: '~/.ssh/id_ed25519',
        hasForwarding: false,
        forwards: [],
      },
      {
        alias: 'api',
        hostname: 'dev.example.com',
        user: 'deploy',
        port: 2222,
        identityFile: '~/.ssh/id_ed25519',
        hasForwarding: false,
        forwards: [],
      },
    ]);
  });

  it('filters wildcard hosts and Match sections', () => {
    // Given: config contains entries that are useful to OpenSSH but not directly clickable.
    const text = `
Host *
  User default-user

Host *.example.com
  Port 2200

Match user deploy
  HostName ignored.example.com

Host concrete
  HostName concrete.example.com
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: only concrete host aliases are exposed.
    expect(hosts).toEqual([
      {
        alias: 'concrete',
        hostname: 'concrete.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ]);
  });

  it('parses local, remote, and dynamic forwarding directives', () => {
    // Given: a host has all forwarding directive kinds configured.
    const text = `
Host dev-tunnel
  HostName bastion.example.com
  LocalForward 127.0.0.1:5433 localhost:5432
  RemoteForward 9000 127.0.0.1:9000
  DynamicForward 127.0.0.1:1080
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: forwarding entries are normalized for later tunnel UI reuse.
    expect(hosts).toEqual([
      {
        alias: 'dev-tunnel',
        hostname: 'bastion.example.com',
        hasForwarding: true,
        forwards: [
          {
            type: 'local',
            bindAddress: '127.0.0.1',
            bindPort: 5433,
            hostAddress: 'localhost',
            hostPort: 5432,
          },
          {
            type: 'remote',
            bindPort: 9000,
            hostAddress: '127.0.0.1',
            hostPort: 9000,
          },
          {
            type: 'dynamic',
            bindAddress: '127.0.0.1',
            bindPort: 1080,
          },
        ],
      },
    ]);
  });

  it('skips a host that declares a non-numeric Port', () => {
    // Given: one host has a Port directive that cannot be parsed and another is valid.
    const text = `
Host bad-port
  HostName bad.example.com
  Port not-a-port

Host valid
  HostName valid.example.com
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: the host with the invalid port is not partially exposed.
    expect(hosts).toEqual([
      {
        alias: 'valid',
        hostname: 'valid.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ]);
  });

  it('skips the host that contains an invalid forwarding port', () => {
    // Given: one host has malformed forwarding and another remains valid.
    const text = `
Host broken
  LocalForward not-a-port localhost:5432

Host valid
  HostName valid.example.com
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: the invalid host is not partially exposed.
    expect(hosts).toEqual([
      {
        alias: 'valid',
        hostname: 'valid.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ]);
  });

  it('recursively expands Include directives and guards cycles', () => {
    // Given: included configs reference each other.
    const includeCalls: Array<{ path: string; context: SshConfigIncludeContext }> = [];
    const includeResolver = (
      includePath: string,
      context: SshConfigIncludeContext,
    ): IncludedSshConfig[] => {
      includeCalls.push({ path: includePath, context });

      if (includePath === '/Users/tester/.ssh/conf.d/hosts') {
        return [
          {
            path: '/Users/tester/.ssh/conf.d/hosts',
            text: `
Include cycle
Host included
  HostName included.example.com
`,
          },
        ];
      }

      if (includePath === '/Users/tester/.ssh/cycle') {
        return [
          {
            path: '/Users/tester/.ssh/config',
            text: `
Host should-not-repeat
  HostName repeat.example.com
`,
          },
        ];
      }

      return [];
    };

    // When: the config is parsed from a known ssh directory.
    const hosts = parseSshConfig(
      `
Include conf.d/hosts
Host root
  HostName root.example.com
`,
      {
        sourcePath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
        includeResolver,
      },
    );

    // Then: included hosts are returned once and cycles do not recurse forever.
    expect(hosts).toEqual([
      {
        alias: 'included',
        hostname: 'included.example.com',
        hasForwarding: false,
        forwards: [],
      },
      {
        alias: 'root',
        hostname: 'root.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ]);
    expect(includeCalls.map((call) => call.path)).toEqual([
      '/Users/tester/.ssh/conf.d/hosts',
      '/Users/tester/.ssh/cycle',
    ]);
    expect(includeCalls[0]?.context).toEqual({
      currentPath: '/Users/tester/.ssh/config',
      sshDirectory: '/Users/tester/.ssh',
    });
  });

  it('forwards tilde-prefixed Include paths to the resolver untouched', () => {
    // Given: a config that includes a tilde-prefixed path the resolver knows how to expand.
    const includeCalls: string[] = [];
    const includeResolver = (includePath: string): IncludedSshConfig[] => {
      includeCalls.push(includePath);
      if (includePath === '~/extra') {
        return [
          {
            path: '/Users/tester/extra',
            text: `
Host tilde-included
  HostName tilde.example.com
`,
          },
        ];
      }
      return [];
    };

    // When: the config is parsed.
    const hosts = parseSshConfig(
      `
Include ~/extra
`,
      {
        sourcePath: '/Users/tester/.ssh/config',
        sshDirectory: '/Users/tester/.ssh',
        includeResolver,
      },
    );

    // Then: the resolver receives the literal ~/extra rather than a joined path.
    expect(includeCalls).toEqual(['~/extra']);
    expect(hosts).toEqual([
      {
        alias: 'tilde-included',
        hostname: 'tilde.example.com',
        hasForwarding: false,
        forwards: [],
      },
    ]);
  });

  it('matches directive names case-insensitively', () => {
    // Given: OpenSSH directives use mixed casing.
    const text = `
HOST mixed
  hostname mixed.example.com
  USER deploy
  localforward 8080 localhost:80
`;

    // When: the config is parsed.
    const hosts = parseSshConfig(text);

    // Then: casing does not affect extraction.
    expect(hosts).toEqual([
      {
        alias: 'mixed',
        hostname: 'mixed.example.com',
        user: 'deploy',
        hasForwarding: true,
        forwards: [
          {
            type: 'local',
            bindPort: 8080,
            hostAddress: 'localhost',
            hostPort: 80,
          },
        ],
      },
    ]);
  });
});
