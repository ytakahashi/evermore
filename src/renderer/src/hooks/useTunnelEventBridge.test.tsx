import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tunnel, TunnelStatus } from '../../../shared/types';
import { useTunnelsStore } from '../stores/tunnelsStore';
import { useTunnelEventBridge } from './useTunnelEventBridge';

const tunnel: Tunnel = {
  alias: 'dev',
  forwards: [
    {
      type: 'dynamic',
      bindPort: 1080,
    },
  ],
  status: 'stopped',
  recentLogs: [],
};

function TestBridge(): React.JSX.Element {
  useTunnelEventBridge();
  return <div>bridge</div>;
}

describe('useTunnelEventBridge', () => {
  let statusCallback: ((alias: string, status: TunnelStatus, error?: string) => void) | null;
  let logCallback: ((alias: string, data: string) => void) | null;
  let unsubscribeStatus: ReturnType<typeof vi.fn>;
  let unsubscribeLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    statusCallback = null;
    logCallback = null;
    unsubscribeStatus = vi.fn();
    unsubscribeLog = vi.fn();
    useTunnelsStore.setState({ tunnels: [], isLoading: false, error: null });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        tunnel: {
          list: vi.fn(() => Promise.resolve([tunnel])),
          start: vi.fn(() => Promise.resolve()),
          stop: vi.fn(() => Promise.resolve()),
          logs: vi.fn(() => Promise.resolve([])),
          onStatusChanged: vi.fn((cb) => {
            statusCallback = cb;
            return unsubscribeStatus;
          }),
          onLog: vi.fn((cb) => {
            logCallback = cb;
            return unsubscribeLog;
          }),
        },
      } as unknown as Window['api'],
    });
  });

  afterEach(() => {
    useTunnelsStore.setState({ tunnels: [], isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
  });

  it('loads initial tunnels and subscribes to runtime events', async () => {
    // Given: the bridge component is not yet mounted.

    // When: the bridge mounts.
    render(<TestBridge />);

    // Then: it fetches the initial tunnel snapshot and subscribes once per event channel.
    await waitFor(() => expect(window.api.tunnel.list).toHaveBeenCalledOnce());
    expect(window.api.tunnel.onStatusChanged).toHaveBeenCalledOnce();
    expect(window.api.tunnel.onLog).toHaveBeenCalledOnce();
    expect(useTunnelsStore.getState().tunnels).toEqual([tunnel]);
  });

  it('mirrors status and log callbacks into the tunnels store', async () => {
    // Given: the bridge has loaded one tunnel.
    render(<TestBridge />);
    await waitFor(() => expect(useTunnelsStore.getState().tunnels).toEqual([tunnel]));

    // When: main-process runtime events arrive through preload subscriptions.
    statusCallback?.('dev', 'running');
    logCallback?.('dev', 'ready');

    // Then: renderer state reflects the updates.
    expect(useTunnelsStore.getState().tunnels[0]).toMatchObject({
      alias: 'dev',
      status: 'running',
      recentLogs: ['ready'],
    });
  });

  it('unsubscribes from runtime events on unmount', () => {
    // Given: the bridge has active subscriptions.
    const { unmount } = render(<TestBridge />);

    // When: the component unmounts.
    unmount();

    // Then: both preload subscriptions are cleaned up.
    expect(unsubscribeStatus).toHaveBeenCalledOnce();
    expect(unsubscribeLog).toHaveBeenCalledOnce();
  });
});
