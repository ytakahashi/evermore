import path from 'node:path';
import { homedir } from 'node:os';
import { LineType, parse } from 'ssh-config';
import type { Directive, Line, Section } from 'ssh-config';
import type { ParsedHostBlock, ParseSshConfigOptions, SshConfigIncludeResolver } from './types';
import type { ForwardEntry, SSHHost } from '../../shared/types';

const DEFAULT_SOURCE_PATH = path.join(homedir(), '.ssh', 'config');
// OpenSSH treats `*`, `?`, and `!` as pattern characters in Host arguments.
// Aliases that contain any of these are pattern entries (e.g. `Host *`,
// `Host !foo`) rather than concrete hosts and are excluded from the UI.
const GLOB_CHARS = /[*?!]/;
const HOST_DIRECTIVES = new Set([
  'hostname',
  'user',
  'port',
  'identityfile',
  'localforward',
  'remoteforward',
  'dynamicforward',
]);

const directiveToForwardType = {
  localforward: 'local',
  remoteforward: 'remote',
  dynamicforward: 'dynamic',
} as const satisfies Record<string, ForwardEntry['type']>;

function normalizeConfigPath(configPath: string): string {
  return path.resolve(configPath);
}

function getDefaultSshDirectory(sourcePath: string): string {
  return path.dirname(sourcePath);
}

function getDirectiveValues(line: Directive): string[] {
  if (typeof line.value === 'string') {
    return [line.value];
  }

  return line.value.map((part) => part.val);
}

function directiveValueToString(line: Directive): string {
  if (typeof line.value === 'string') {
    return line.value.trim();
  }

  return line.value
    .map((part) => part.val)
    .join(' ')
    .trim();
}

function isSection(line: Line): line is Section {
  return line.type === LineType.DIRECTIVE && 'config' in line;
}

function isHostSection(line: Line): line is Section {
  return isSection(line) && line.param.toLowerCase() === 'host';
}

function isTopLevelInclude(line: Line): line is Directive {
  return (
    line.type === LineType.DIRECTIVE &&
    line.param.toLowerCase() === 'include' &&
    !('config' in line)
  );
}

function shouldExposeAlias(alias: string): boolean {
  return alias.length > 0 && !GLOB_CHARS.test(alias);
}

function parseIntegerPort(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const port = Number(value);
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function parseEndpoint(endpoint: string): {
  bindAddress?: string;
  port: number;
} | null {
  const parts = endpoint.split(':');
  const portValue = parts.pop();
  if (!portValue) {
    return null;
  }

  const port = parseIntegerPort(portValue);
  if (port === null) {
    return null;
  }

  const joined = parts.join(':');
  const bindAddress = joined.length > 0 ? joined : undefined;
  return { bindAddress, port };
}

function parseHostEndpoint(endpoint: string): { hostAddress: string; hostPort: number } | null {
  const separatorIndex = endpoint.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex === endpoint.length - 1) {
    return null;
  }

  const hostAddress = endpoint.slice(0, separatorIndex);
  const hostPort = parseIntegerPort(endpoint.slice(separatorIndex + 1));
  if (hostPort === null) {
    return null;
  }

  return { hostAddress, hostPort };
}

function parseForwardLine(type: ForwardEntry['type'], value: string): ForwardEntry | null {
  const tokens = value.split(/\s+/).filter(Boolean);
  if (type === 'dynamic') {
    if (tokens.length !== 1) {
      return null;
    }

    const endpoint = parseEndpoint(tokens[0] ?? '');
    if (!endpoint) {
      return null;
    }

    return {
      type,
      bindAddress: endpoint.bindAddress,
      bindPort: endpoint.port,
    };
  }

  if (tokens.length !== 2) {
    return null;
  }

  const bindEndpoint = parseEndpoint(tokens[0] ?? '');
  const hostEndpoint = parseHostEndpoint(tokens[1] ?? '');
  if (!bindEndpoint || !hostEndpoint) {
    return null;
  }

  return {
    type,
    bindAddress: bindEndpoint.bindAddress,
    bindPort: bindEndpoint.port,
    hostAddress: hostEndpoint.hostAddress,
    hostPort: hostEndpoint.hostPort,
  };
}

function parseForwardEntries(directives: Record<string, string[]>): ForwardEntry[] | null {
  const forwards: ForwardEntry[] = [];

  for (const [directive, type] of Object.entries(directiveToForwardType)) {
    for (const value of directives[directive] ?? []) {
      const forward = parseForwardLine(type, value);
      if (!forward) {
        return null;
      }
      forwards.push(forward);
    }
  }

  return forwards;
}

function collectHostBlock(section: Section): ParsedHostBlock {
  const directives: Record<string, string[]> = {};

  for (const line of section.config) {
    if (line.type !== LineType.DIRECTIVE) {
      continue;
    }

    const key = line.param.toLowerCase();
    if (!HOST_DIRECTIVES.has(key)) {
      continue;
    }

    (directives[key] ??= []).push(directiveValueToString(line));
  }

  return {
    aliases: getDirectiveValues(section),
    directives,
  };
}

function hostBlockToHosts(block: ParsedHostBlock): SSHHost[] {
  const portValue = block.directives.port?.[0];
  const port = portValue === undefined ? undefined : parseIntegerPort(portValue);
  if (portValue !== undefined && port === null) {
    return [];
  }

  const forwards = parseForwardEntries(block.directives);
  if (forwards === null) {
    return [];
  }

  return block.aliases.filter(shouldExposeAlias).map((alias): SSHHost => {
    // Clone forwards so downstream mutations on one alias do not leak into
    // sibling aliases that share the same Host block.
    const host: SSHHost = {
      alias,
      hasForwarding: forwards.length > 0,
      forwards: forwards.map((forward) => ({ ...forward })),
    };

    const hostname = block.directives.hostname?.[0];
    if (hostname !== undefined) {
      host.hostname = hostname;
    }

    const user = block.directives.user?.[0];
    if (user !== undefined) {
      host.user = user;
    }

    if (port !== undefined && port !== null) {
      host.port = port;
    }

    const identityFile = block.directives.identityfile?.[0];
    if (identityFile !== undefined) {
      host.identityFile = identityFile;
    }

    return host;
  });
}

function resolveIncludePath(includePath: string, sshDirectory: string): string {
  // Tilde-prefixed paths (e.g. `Include ~/foo`) are passed through untouched
  // so the resolver can perform OpenSSH-compatible home expansion. Joining
  // them with sshDirectory here would produce `<sshDirectory>/~/foo`, which
  // matches no real file and would silently drop the include.
  if (includePath === '~' || includePath.startsWith('~/')) {
    return includePath;
  }

  if (path.isAbsolute(includePath)) {
    return normalizeConfigPath(includePath);
  }

  return normalizeConfigPath(path.join(sshDirectory, includePath));
}

function collectIncludedHosts(
  includePath: string,
  currentPath: string,
  sshDirectory: string,
  includeResolver: SshConfigIncludeResolver | undefined,
  visitedPaths: Set<string>,
): SSHHost[] {
  if (!includeResolver) {
    return [];
  }

  const includes = includeResolver(includePath, { currentPath, sshDirectory });
  const hosts: SSHHost[] = [];

  for (const included of includes) {
    const normalizedPath = normalizeConfigPath(included.path);
    if (visitedPaths.has(normalizedPath)) {
      continue;
    }

    hosts.push(
      ...parseConfigDocument(
        included.text,
        normalizedPath,
        sshDirectory,
        includeResolver,
        visitedPaths,
      ),
    );
  }

  return hosts;
}

function parseConfigDocument(
  text: string,
  sourcePath: string,
  sshDirectory: string,
  includeResolver: SshConfigIncludeResolver | undefined,
  visitedPaths: Set<string>,
): SSHHost[] {
  const normalizedSourcePath = normalizeConfigPath(sourcePath);
  if (visitedPaths.has(normalizedSourcePath)) {
    return [];
  }
  visitedPaths.add(normalizedSourcePath);

  const config = parse(text);
  const hosts: SSHHost[] = [];

  for (const line of config) {
    if (isTopLevelInclude(line)) {
      for (const includePath of getDirectiveValues(line)) {
        hosts.push(
          ...collectIncludedHosts(
            resolveIncludePath(includePath, sshDirectory),
            normalizedSourcePath,
            sshDirectory,
            includeResolver,
            visitedPaths,
          ),
        );
      }
      continue;
    }

    if (!isHostSection(line)) {
      continue;
    }

    hosts.push(...hostBlockToHosts(collectHostBlock(line)));
  }

  return hosts;
}

/**
 * Parses OpenSSH config text into UI-ready SSH host records without performing file I/O.
 */
export function parseSshConfig(text: string, options: ParseSshConfigOptions = {}): SSHHost[] {
  const sourcePath = normalizeConfigPath(options.sourcePath ?? DEFAULT_SOURCE_PATH);
  const sshDirectory = normalizeConfigPath(
    options.sshDirectory ?? getDefaultSshDirectory(sourcePath),
  );

  return parseConfigDocument(text, sourcePath, sshDirectory, options.includeResolver, new Set());
}
