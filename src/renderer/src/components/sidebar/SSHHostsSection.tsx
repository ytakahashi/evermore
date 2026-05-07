import { ChevronDown, ChevronRight, RefreshCw, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SSHHost } from '../../../../shared/types';
import { useReloadConnections } from '../../hooks/useReloadConnections';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useSshResolutionsStore } from '../../stores/sshResolutionsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

function formatHostDetail(host: SSHHost): string | null {
  // Skip the subtitle entirely when none of HostName / User / Port is configured,
  // so a bare `Host alias` block does not render the alias twice.
  if (!host.hostname && !host.user && host.port === undefined) {
    return null;
  }

  const hostname = host.hostname ?? host.alias;
  const userPrefix = host.user ? `${host.user}@` : '';
  const portSuffix = host.port ? `:${host.port}` : '';
  return `${userPrefix}${hostname}${portSuffix}`;
}

function ResolutionDetail({ alias }: { alias: string }): React.JSX.Element | null {
  const resolution = useSshResolutionsStore((state) => state.resolutions[alias]);
  const resolveAlias = useSshResolutionsStore((state) => state.resolveAlias);

  // Trigger resolution on mount and whenever the cache is cleared (e.g. after a reload),
  // so an already-expanded row re-fetches without requiring a collapse + reopen.
  useEffect(() => {
    if (!resolution) {
      void resolveAlias(alias);
    }
  }, [alias, resolution, resolveAlias]);

  if (!resolution) {
    return <div className="mt-2 pl-4 text-xs italic text-subtle">Resolving...</div>;
  }

  if (resolution.status === 'loading') {
    return <div className="mt-2 pl-4 text-xs italic text-subtle">Resolving...</div>;
  }

  if (resolution.status === 'error') {
    return (
      <div className="mt-2 space-y-1 pl-4 text-xs">
        <div className="text-danger">Error: {resolution.error}</div>
        <button
          className="text-brand hover:underline"
          type="button"
          onClick={() => {
            void resolveAlias(alias);
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (resolution.status === 'ready' && resolution.data) {
    const data = resolution.data;
    const directives = [
      { key: 'hostname', label: 'Host' },
      { key: 'user', label: 'User' },
      { key: 'port', label: 'Port' },
      { key: 'identityfile', label: 'Identity' },
      { key: 'proxyjump', label: 'ProxyJump' },
      { key: 'forwardagent', label: 'AgentFwd' },
    ];

    return (
      <dl className="mt-2 space-y-1 border-l border-border-subtle pl-4 text-[11px]">
        {directives.map(({ key, label }) => {
          const values = data[key];
          if (!values || values.length === 0) return null;
          return (
            <div key={key} className="flex gap-2">
              <dt className="w-16 shrink-0 font-medium uppercase text-subtle">{label}</dt>
              <dd className="min-w-0 flex-1 truncate text-muted">
                {values.map((v, i) => (
                  <div key={i} className="truncate">
                    {v || '(none)'}
                  </div>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
    );
  }

  return null;
}

interface HostRowProps {
  expanded: boolean;
  host: SSHHost;
  onOpen: (alias: string) => void;
  onToggle: (alias: string) => void;
}

function HostRow({ expanded, host, onOpen, onToggle }: HostRowProps): React.JSX.Element {
  const detail = formatHostDetail(host);

  const handleToggle = (): void => {
    onToggle(host.alias);
  };

  return (
    <div className="group rounded-md px-2 py-1.5 text-sm text-muted hover:bg-raised/50">
      <div className="flex min-w-0 items-start gap-2">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-1 text-left"
          type="button"
          onClick={handleToggle}
        >
          <span className="mt-0.5 shrink-0 text-subtle group-hover:text-brand">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <Server size={13} className="shrink-0 text-subtle/70" />
              <span className="truncate text-foreground">{host.alias}</span>
              {host.hasForwarding && (
                <span
                  aria-label="has port forwarding"
                  className="rounded border border-border px-1 py-px text-[9px] font-bold uppercase text-subtle"
                  title="Has port forwarding configured"
                >
                  fwd
                </span>
              )}
            </span>
            {!expanded && detail && (
              <span className="block truncate pl-4 text-xs text-subtle">{detail}</span>
            )}
          </span>
        </button>
        <button
          aria-label={`Open ssh ${host.alias}`}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-foreground"
          type="button"
          onClick={() => onOpen(host.alias)}
        >
          Open
        </button>
      </div>
      {expanded && <ResolutionDetail alias={host.alias} />}
    </div>
  );
}

/**
 * Renders SSH hosts parsed from `~/.ssh/config` and exposes manual reload.
 */
export function SSHHostsSection(): React.JSX.Element {
  const hosts = useConnectionsStore((state) => state.hosts);
  const isLoading = useConnectionsStore((state) => state.isLoading);
  const error = useConnectionsStore((state) => state.error);
  const openSshHostTab = useWorkspaceStore((state) => state.openSshHostTab);
  const { isReloading, reloadConnections } = useReloadConnections();
  const [expandedAliases, setExpandedAliases] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (alias: string): void => {
    setExpandedAliases((current) => {
      const next = new Set(current);
      if (next.has(alias)) {
        next.delete(alias);
      } else {
        next.add(alias);
      }
      return next;
    });
  };

  let content: React.ReactNode;
  if (isLoading) {
    content = <div className="px-2 py-1 text-sm text-muted">Loading SSH hosts...</div>;
  } else if (error) {
    content = (
      <div className="space-y-2 px-2 py-1 text-sm">
        <div className="text-danger">{error}</div>
        <button
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-raised hover:text-foreground"
          type="button"
          onClick={() => {
            void reloadConnections();
          }}
        >
          Retry
        </button>
      </div>
    );
  } else if (hosts.length === 0) {
    content = <div className="px-2 py-1 text-sm text-muted">No hosts found in ~/.ssh/config</div>;
  } else {
    content = (
      <div className="space-y-0.5">
        {hosts.map((host, index) => (
          // Index is appended because OpenSSH allows the same alias to appear in multiple
          // Include files; alias alone is not guaranteed unique across the merged list.
          <HostRow
            key={`${host.alias}-${index}`}
            expanded={expandedAliases.has(host.alias)}
            host={host}
            onOpen={openSshHostTab}
            onToggle={toggleExpanded}
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
        <span>SSH Hosts</span>
        <button
          aria-label="Reload SSH hosts"
          className="flex size-4 items-center justify-center rounded hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40"
          disabled={isReloading}
          title="Reload SSH hosts"
          type="button"
          onClick={() => {
            void reloadConnections();
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {content}
    </section>
  );
}
