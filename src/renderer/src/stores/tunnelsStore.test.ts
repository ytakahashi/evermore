import { describe, expect, it, vi } from 'vitest';
import type { Tunnel } from '../../../shared/types';
import {
  createTunnelsStore,
  selectErrorTunnelCount,
  selectRunningTunnelCount,
} from './tunnelsStore';

type TunnelApiMock = Pick<Window['api']['tunnel'], 'list' | 'start' | 'stop'>;

const tunnel: Tunnel = {
  alias: 'dev',
  forwards: [
    {
      type: 'local',
      bindPort: 5432,
      hostAddress: 'localhost',
      hostPort: 5432,
    },
  ],
  status: 'stopped',
  recentLogs: [],
};

function createTunnelApi(overrides: Partial<TunnelApiMock> = {}): TunnelApiMock {
  return {
    list: vi.fn(() => Promise.resolve([tunnel])),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('tunnelsStore', () => {
  it('loads tunnels through the API', async () => {
    // Given: the preload tunnel API returns eligible tunnel entries.
    const tunnelApi = createTunnelApi();
    const useStore = createTunnelsStore({ tunnelApi });

    // When: tunnels are loaded.
    await useStore.getState().loadTunnels();

    // Then: the store exposes the tunnel list.
    expect(tunnelApi.list).toHaveBeenCalledOnce();
    expect(useStore.getState()).toMatchObject({
      tunnels: [tunnel],
      isLoading: false,
      error: null,
    });
  });

  it('stores an error message while preserving the last loaded tunnels when loading fails', async () => {
    // Given: a previous tunnel snapshot exists and the next API request rejects.
    const tunnelApi = createTunnelApi({
      list: vi.fn(() => Promise.reject(new Error('cannot list tunnels'))),
    });
    const useStore = createTunnelsStore({ tunnelApi });
    useStore.setState({ tunnels: [tunnel] });

    // When: loading fails.
    await useStore.getState().loadTunnels();

    // Then: the failure is captured without clearing the usable snapshot.
    expect(useStore.getState()).toMatchObject({
      tunnels: [tunnel],
      isLoading: false,
      error: 'cannot list tunnels',
    });
  });

  it('starts and stops tunnels through the API without optimistic status changes', async () => {
    // Given: a tunnel API can accept lifecycle requests.
    const tunnelApi = createTunnelApi();
    const useStore = createTunnelsStore({ tunnelApi });
    useStore.setState({ tunnels: [tunnel] });

    // When: a tunnel is started and stopped.
    await useStore.getState().startTunnel('dev');
    await useStore.getState().stopTunnel('dev');

    // Then: API calls are made and status remains event-driven.
    expect(tunnelApi.start).toHaveBeenCalledWith('dev');
    expect(tunnelApi.stop).toHaveBeenCalledWith('dev');
    expect(useStore.getState().tunnels[0]?.status).toBe('stopped');
  });

  it('stores an error message when start or stop fails', async () => {
    // Given: lifecycle calls can fail.
    const tunnelApi = createTunnelApi({
      start: vi.fn(() => Promise.reject(new Error('start failed'))),
      stop: vi.fn(() => Promise.reject('stop failed')),
    });
    const useStore = createTunnelsStore({ tunnelApi });

    // When: start and stop requests reject.
    await useStore.getState().startTunnel('dev');
    const startError = useStore.getState().error;
    await useStore.getState().stopTunnel('dev');

    // Then: each failure is exposed to the UI.
    expect(startError).toBe('start failed');
    expect(useStore.getState().error).toBe('stop failed');
  });

  it('updates status, running time, and last error from runtime events', () => {
    // Given: a loaded tunnel with an existing error message.
    const useStore = createTunnelsStore({ now: () => 2500 });
    useStore.setState({
      tunnels: [
        {
          ...tunnel,
          status: 'error',
          lastError: 'previous failure',
        },
      ],
    });

    // When: status events arrive without and with an error payload.
    useStore.getState().setStatus('dev', 'running');
    useStore.getState().setStatus('dev', 'error', 'bind failed');

    // Then: running sets startedAt, omitted error preserves prior value, explicit error replaces it.
    expect(useStore.getState().tunnels[0]).toMatchObject({
      status: 'error',
      startedAt: 2500,
      lastError: 'bind failed',
    });
  });

  it('clears startedAt when a tunnel stops', () => {
    // Given: a running tunnel has a renderer-side start time.
    const useStore = createTunnelsStore();
    useStore.setState({
      tunnels: [
        {
          ...tunnel,
          status: 'running',
          startedAt: 2500,
        },
      ],
    });

    // When: the tunnel stops.
    useStore.getState().setStatus('dev', 'stopped');

    // Then: status changes and the running timestamp is cleared.
    expect(useStore.getState().tunnels[0]).toMatchObject({
      status: 'stopped',
      startedAt: undefined,
    });
  });

  it('keeps only the most recent log lines', () => {
    // Given: a store with a small log buffer.
    const useStore = createTunnelsStore({ logBufferSize: 3 });
    useStore.setState({ tunnels: [{ ...tunnel, recentLogs: ['one'] }] });

    // When: more log lines arrive than the buffer can keep.
    useStore.getState().appendLog('dev', 'two');
    useStore.getState().appendLog('dev', 'three');
    useStore.getState().appendLog('dev', 'four');

    // Then: the oldest lines are discarded first.
    expect(useStore.getState().tunnels[0]?.recentLogs).toEqual(['two', 'three', 'four']);
  });

  it('ignores runtime events for aliases not present in the loaded tunnel list', () => {
    // Given: no tunnel entry exists for the event alias.
    const useStore = createTunnelsStore();

    // When: events arrive for an unknown alias.
    useStore.getState().setStatus('missing', 'running');
    useStore.getState().appendLog('missing', 'line');

    // Then: config-ineligible tunnels are not created in renderer state.
    expect(useStore.getState().tunnels).toEqual([]);
  });

  it('selects running and error tunnel counts', () => {
    // Given: tunnel state contains multiple runtime states.
    const useStore = createTunnelsStore();
    useStore.setState({
      tunnels: [
        {
          ...tunnel,
          alias: 'running-1',
          status: 'running',
        },
        {
          ...tunnel,
          alias: 'running-2',
          status: 'running',
        },
        {
          ...tunnel,
          alias: 'failed',
          status: 'error',
        },
        {
          ...tunnel,
          alias: 'stopped',
          status: 'stopped',
        },
      ],
    });

    // When: selectors read the current tunnel state.
    const state = useStore.getState();

    // Then: each selector counts only its matching status.
    expect(selectRunningTunnelCount(state)).toBe(2);
    expect(selectErrorTunnelCount(state)).toBe(1);
  });
});
