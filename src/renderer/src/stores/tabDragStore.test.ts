import { afterEach, describe, expect, it } from 'vitest';
import { useTabDragStore } from './tabDragStore';

describe('useTabDragStore', () => {
  afterEach(() => {
    useTabDragStore.getState().end();
  });

  it('records the drag source on begin', () => {
    // Given: no drag in flight.
    expect(useTabDragStore.getState().dragging).toBeNull();

    // When: a drag begins.
    useTabDragStore.getState().begin({ sourceWorkspaceId: 'workspace-1', tabId: 'tab-1' });

    // Then: the source descriptor is exposed for the hover/drop handlers to read.
    expect(useTabDragStore.getState().dragging).toEqual({
      sourceWorkspaceId: 'workspace-1',
      tabId: 'tab-1',
    });
  });

  it('clears the drag source on end', () => {
    // Given: a drag in flight.
    useTabDragStore.getState().begin({ sourceWorkspaceId: 'workspace-1', tabId: 'tab-1' });

    // When: the drag ends.
    useTabDragStore.getState().end();

    // Then: nothing is being dragged.
    expect(useTabDragStore.getState().dragging).toBeNull();
  });
});
