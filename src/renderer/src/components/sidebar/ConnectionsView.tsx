import { useEffect, useRef } from 'react';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { SSHHostsSection } from './SSHHostsSection';
import { TunnelsSection } from './TunnelsSection';

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
      <TunnelsSection />
    </div>
  );
}
