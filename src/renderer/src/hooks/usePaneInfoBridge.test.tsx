import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeInfo } from '../../../shared/types';
import { usePaneInfoStore } from '../stores/paneInfoStore';
import { usePaneInfoBridge } from './usePaneInfoBridge';

const info: PaneRuntimeInfo = {
  ptyId: 'pty-1',
  activity: 'idle',
  observedAt: 1000,
};

function TestBridge(): React.JSX.Element {
  usePaneInfoBridge();
  return <div>bridge</div>;
}

describe('usePaneInfoBridge', () => {
  let changedCallback: ((info: PaneRuntimeInfo) => void) | null;
  let unsubscribeChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    changedCallback = null;
    unsubscribeChanged = vi.fn();
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        paneInfo: {
          list: vi.fn(() => Promise.resolve([info])),
          notifyCommand: vi.fn(() => Promise.resolve()),
          notifyCwd: vi.fn(() => Promise.resolve()),
          onChanged: vi.fn((cb) => {
            changedCallback = cb;
            return unsubscribeChanged;
          }),
        },
      } as unknown as Window['api'],
    });
  });

  afterEach(() => {
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    Reflect.deleteProperty(window, 'api');
  });

  it('loads initial pane info and subscribes to runtime changes', async () => {
    // Given: the bridge component is not yet mounted.

    // When: the bridge mounts.
    render(<TestBridge />);

    // Then: it fetches the initial snapshot and subscribes to changed events.
    await waitFor(() => expect(window.api.paneInfo.list).toHaveBeenCalledOnce());
    expect(window.api.paneInfo.onChanged).toHaveBeenCalledOnce();
    expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': info });
  });

  it('mirrors changed callbacks into the pane info store', async () => {
    // Given: the bridge is mounted.
    render(<TestBridge />);
    await waitFor(() =>
      expect(usePaneInfoStore.getState().infosByPtyId).toEqual({ 'pty-1': info }),
    );

    // When: main-process runtime events arrive through preload subscriptions.
    const runningInfo: PaneRuntimeInfo = {
      ptyId: 'pty-1',
      activity: 'running',
      foregroundCommand: 'pnpm dev',
      observedAt: 1001,
    };
    changedCallback?.(runningInfo);

    // Then: renderer state reflects the update.
    expect(usePaneInfoStore.getState().infosByPtyId['pty-1']).toEqual(runningInfo);
  });

  it('unsubscribes from runtime events on unmount', () => {
    // Given: the bridge has active subscriptions.
    const { unmount } = render(<TestBridge />);

    // When: the component unmounts.
    unmount();

    // Then: the preload subscription is cleaned up.
    expect(unsubscribeChanged).toHaveBeenCalledOnce();
  });
});
