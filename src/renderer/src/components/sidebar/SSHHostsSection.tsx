import { RefreshCw, Server } from 'lucide-react';
import type { SSHHost } from '../../../../shared/types';
import { useConnectionsStore } from '../../stores/connectionsStore';
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

interface HostRowProps {
  host: SSHHost;
  onOpen: (alias: string) => void;
}

function HostRow({ host, onOpen }: HostRowProps): React.JSX.Element {
  const detail = formatHostDetail(host);
  return (
    <button
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-raised/50 hover:text-foreground"
      type="button"
      onClick={() => {
        onOpen(host.alias);
      }}
    >
      <Server size={14} className="mt-0.5 shrink-0 text-subtle group-hover:text-brand" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-foreground">{host.alias}</span>
          {host.hasForwarding && (
            <span
              aria-label="has port forwarding"
              title="Has port forwarding configured"
              className="rounded border border-border px-1 py-px text-[9px] font-bold uppercase text-subtle"
            >
              fwd
            </span>
          )}
        </span>
        {detail && <span className="block truncate text-xs text-subtle">{detail}</span>}
      </span>
    </button>
  );
}

/**
 * Renders SSH hosts parsed from `~/.ssh/config` and exposes manual reload.
 */
export function SSHHostsSection(): React.JSX.Element {
  const hosts = useConnectionsStore((state) => state.hosts);
  const isLoading = useConnectionsStore((state) => state.isLoading);
  const error = useConnectionsStore((state) => state.error);
  const reloadHosts = useConnectionsStore((state) => state.reloadHosts);
  const openSshHostTab = useWorkspaceStore((state) => state.openSshHostTab);

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
            void reloadHosts();
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
          <HostRow key={`${host.alias}-${index}`} host={host} onOpen={openSshHostTab} />
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
          disabled={isLoading}
          title="Reload SSH hosts"
          type="button"
          onClick={() => {
            void reloadHosts();
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {content}
    </section>
  );
}
