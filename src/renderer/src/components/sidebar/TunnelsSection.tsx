import { ChevronDown, ChevronRight, Play, RefreshCw, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ForwardEntry, Tunnel, TunnelStatus } from '../../../../shared/types';
import { useReloadConnections } from '../../hooks/useReloadConnections';
import { useTunnelsStore } from '../../stores/tunnelsStore';

const ACTION_DISABLE_MS = 500;
const LOG_PREVIEW_LINES = 8;
const TUNNEL_TIP = 'Tip: Set ExitOnForwardFailure yes in ~/.ssh/config for faster error detection.';

function formatBindEndpoint(forward: ForwardEntry): string {
  if (forward.type === 'dynamic') {
    const bindAddress = forward.bindAddress ? `${forward.bindAddress}:` : ':';
    return `SOCKS ${bindAddress}${forward.bindPort}`;
  }

  const bindAddress = forward.bindAddress ?? '127.0.0.1';
  return `${bindAddress}:${forward.bindPort}`;
}

function formatTargetEndpoint(forward: ForwardEntry): string {
  if (forward.type === 'dynamic') {
    return 'dynamic proxy';
  }

  const hostAddress = forward.hostAddress ?? 'localhost';
  const hostPort = forward.hostPort !== undefined ? `:${forward.hostPort}` : '';
  return `${hostAddress}${hostPort}`;
}

function formatForward(forward: ForwardEntry): string {
  if (forward.type === 'dynamic') {
    return formatBindEndpoint(forward);
  }

  return `${formatBindEndpoint(forward)} → ${formatTargetEndpoint(forward)}`;
}

function formatForwardSummary(tunnel: Tunnel): string {
  if (tunnel.forwards.length === 1 && tunnel.forwards[0]) {
    return formatForward(tunnel.forwards[0]);
  }

  return `${tunnel.forwards.length} forwards`;
}

function statusLabel(status: TunnelStatus): string {
  if (status === 'starting') {
    return 'Starting';
  }
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'error') {
    return 'Error';
  }

  return 'Stopped';
}

function statusDotClassName(status: TunnelStatus): string {
  if (status === 'starting') {
    return 'bg-status-running motion-safe:animate-pulse';
  }
  if (status === 'running') {
    return 'bg-status-running';
  }
  if (status === 'error') {
    return 'bg-status-error';
  }

  return 'bg-status-stopped';
}

interface TunnelRowProps {
  disabled: boolean;
  expanded: boolean;
  onAction: (alias: string, status: TunnelStatus) => void;
  onToggle: (alias: string) => void;
  tunnel: Tunnel;
}

function TunnelRow({
  disabled,
  expanded,
  onAction,
  onToggle,
  tunnel,
}: TunnelRowProps): React.JSX.Element {
  const isStopAction = tunnel.status === 'starting' || tunnel.status === 'running';
  const actionLabel = isStopAction ? 'Stop' : 'Start';
  const actionIcon = isStopAction ? <Square size={11} /> : <Play size={11} />;
  const statusText = statusLabel(tunnel.status);
  const logs = tunnel.recentLogs.slice(-LOG_PREVIEW_LINES);

  return (
    <div className="rounded-md px-2 py-1.5 text-sm text-muted hover:bg-raised/50">
      <div className="flex min-w-0 items-start gap-2">
        <span
          aria-label={statusText}
          className={`mt-1.5 size-2 shrink-0 rounded-full ${statusDotClassName(tunnel.status)}`}
          title={statusText}
        />
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-start gap-1 text-left"
          type="button"
          onClick={() => {
            onToggle(tunnel.alias);
          }}
        >
          <span className="mt-0.5 shrink-0 text-subtle">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{tunnel.alias}</span>
            <span className="block truncate text-xs text-subtle">
              {formatForwardSummary(tunnel)}
            </span>
          </span>
        </button>
        <button
          aria-busy={disabled}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40"
          disabled={disabled}
          type="button"
          onClick={() => {
            onAction(tunnel.alias, tunnel.status);
          }}
        >
          {actionIcon}
          {actionLabel}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 border-l border-border-subtle pl-4 text-xs">
          <div className="space-y-1">
            {tunnel.forwards.map((forward, index) => (
              <div key={`${tunnel.alias}-forward-${index}`} className="text-muted">
                <span className="uppercase text-subtle">{forward.type}</span>{' '}
                <span>{formatForward(forward)}</span>
              </div>
            ))}
          </div>
          {tunnel.lastError && (
            <div className="text-danger">
              <span className="text-subtle">Last error:</span> {tunnel.lastError}
            </div>
          )}
          {logs.length > 0 && (
            <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded bg-terminal p-2 font-mono text-[11px] leading-relaxed text-muted">
              {logs.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders SSH tunnels parsed from `~/.ssh/config` and exposes tunnel lifecycle controls.
 */
export function TunnelsSection(): React.JSX.Element {
  const tunnels = useTunnelsStore((state) => state.tunnels);
  const isLoading = useTunnelsStore((state) => state.isLoading);
  const error = useTunnelsStore((state) => state.error);
  const startTunnel = useTunnelsStore((state) => state.startTunnel);
  const stopTunnel = useTunnelsStore((state) => state.stopTunnel);
  const { isReloading, reloadConnections } = useReloadConnections();
  const [expandedAliases, setExpandedAliases] = useState<Set<string>>(() => new Set());
  const [busyAliases, setBusyAliases] = useState<Set<string>>(() => new Set());
  const busyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const busyTimers = busyTimersRef.current;
    return (): void => {
      for (const timer of busyTimers.values()) {
        clearTimeout(timer);
      }
      busyTimers.clear();
    };
  }, []);

  const markBusy = (alias: string): void => {
    setBusyAliases((current) => new Set(current).add(alias));
    const previousTimer = busyTimersRef.current.get(alias);
    if (previousTimer) {
      clearTimeout(previousTimer);
    }

    const timer = setTimeout(() => {
      busyTimersRef.current.delete(alias);
      setBusyAliases((current) => {
        const next = new Set(current);
        next.delete(alias);
        return next;
      });
    }, ACTION_DISABLE_MS);
    busyTimersRef.current.set(alias, timer);
  };

  const handleAction = (alias: string, status: TunnelStatus): void => {
    markBusy(alias);
    if (status === 'starting' || status === 'running') {
      void stopTunnel(alias);
      return;
    }

    void startTunnel(alias);
  };

  const handleReload = async (): Promise<void> => {
    await reloadConnections();
  };

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
    content = <div className="px-2 py-1 text-sm text-muted">Loading tunnels...</div>;
  } else if (error) {
    content = (
      <div className="space-y-2 px-2 py-1 text-sm">
        <div className="text-danger">{error}</div>
        <button
          className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-raised hover:text-foreground"
          type="button"
          onClick={() => {
            void handleReload();
          }}
        >
          Retry
        </button>
      </div>
    );
  } else if (tunnels.length === 0) {
    content = (
      <div className="px-2 py-1 text-sm text-muted">No tunnels configured in ~/.ssh/config</div>
    );
  } else {
    content = (
      <div className="space-y-0.5">
        {tunnels.map((tunnel) => (
          <TunnelRow
            key={tunnel.alias}
            disabled={busyAliases.has(tunnel.alias)}
            expanded={expandedAliases.has(tunnel.alias)}
            tunnel={tunnel}
            onAction={handleAction}
            onToggle={toggleExpanded}
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
        <span>Tunnels</span>
        <button
          aria-label="Reload tunnels"
          className="flex size-4 items-center justify-center rounded hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-40"
          disabled={isReloading}
          title="Reload tunnels"
          type="button"
          onClick={() => {
            void handleReload();
          }}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="px-2 py-1 text-xs text-subtle">{TUNNEL_TIP}</div>
      {content}
    </section>
  );
}
