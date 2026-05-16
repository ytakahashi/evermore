import { describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { createPaneInfoStore } from './paneInfoStore';

const runningInfo: PaneRuntimeInfo = {
  ptyId: 'pty-1',
  activity: 'running',
  processActivity: 'running',
  foregroundCommand: 'pnpm test',
  foregroundSession: { kind: 'other' },
  integration: {
    shell: false,
    protocols: [],
    lastSequenceAt: 0,
    stale: false,
  },
  observedAt: 1000,
};

describe('paneInfoStore', () => {
  it('loads pane runtime info keyed by PTY id', async () => {
    // Given: the preload pane info API returns a snapshot.
    const useStore = createPaneInfoStore({
      paneInfoApi: {
        list: vi.fn(() => Promise.resolve([runningInfo])),
      },
    });

    // When: runtime info is loaded.
    await useStore.getState().loadPaneInfo();

    // Then: it is indexed for fast sidebar lookup.
    expect(useStore.getState().infosByPtyId).toEqual({ 'pty-1': runningInfo });
  });

  it('preserves the last snapshot when loading fails', async () => {
    // Given: the store already has a previous runtime event.
    const useStore = createPaneInfoStore({
      paneInfoApi: {
        list: vi.fn(() => Promise.reject(new Error('unavailable'))),
      },
    });
    useStore.getState().setInfo(runningInfo);

    // When: loading fails.
    await useStore.getState().loadPaneInfo();

    // Then: the last known pane info remains available.
    expect(useStore.getState().infosByPtyId).toEqual({ 'pty-1': runningInfo });
    expect(useStore.getState().error).toBe('unavailable');
  });
});
