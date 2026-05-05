import { useEffect, useRef } from 'react';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { SSHHostsSection } from './SSHHostsSection';

/**
 * Hosts the Connections sidebar sections and performs the initial SSH config load.
 */
export function ConnectionsView(): React.JSX.Element {
  const loadHosts = useConnectionsStore((state) => state.loadHosts);
  const didLoadRef = useRef(false);

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }

    didLoadRef.current = true;
    void loadHosts();
  }, [loadHosts]);

  return (
    <div className="mb-4 space-y-4">
      <SSHHostsSection />
      <div>
        <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-subtle">
          Tunnels
        </div>
        <div className="px-2 py-1 text-sm text-muted">Coming soon</div>
      </div>
    </div>
  );
}
