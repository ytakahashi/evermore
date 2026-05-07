import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useUiStore,
} from '../../stores/uiStore';
import { Sidebar } from './Sidebar';

vi.mock('../sidebar/WorkspacesView', () => ({
  WorkspacesView: () => <div>Workspace view mock</div>,
}));

vi.mock('../sidebar/ConnectionsView', () => ({
  ConnectionsView: () => <div>Connections view mock</div>,
}));

describe('Sidebar', () => {
  afterEach(() => {
    useUiStore.setState({
      sidebarView: 'workspaces',
      sidebarOpen: true,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it('renders the workspaces view by default', () => {
    // Given: the sidebar store is in its initial state.

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: workspace content is visible and connections content is not.
    expect(screen.getByText('Workspace view mock')).toBeInTheDocument();
    expect(screen.queryByText('Connections view mock')).not.toBeInTheDocument();
  });

  it('renders the connections view when selected', () => {
    // Given: the connections view has been selected.
    useUiStore.setState({ sidebarView: 'connections' });

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: connections content is visible and workspace content is not.
    expect(screen.getByText('Connections view mock')).toBeInTheDocument();
    expect(screen.queryByText('Workspace view mock')).not.toBeInTheDocument();
  });

  it('returns null when sidebar is closed', () => {
    // Given: the sidebar is marked as closed in the store.
    useUiStore.setState({ sidebarOpen: false });

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: the aside element is not rendered.
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('applies the dynamic width from the store', () => {
    // Given: the sidebar has a custom width.
    useUiStore.setState({ sidebarWidth: 320 });

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: the width is applied as an inline style.
    const aside = screen.getByRole('complementary');
    expect(aside.style.width).toBe('320px');
  });

  it('renders the resize handle', () => {
    // Given: the sidebar is open.

    // When: the sidebar renders.
    render(<Sidebar />);

    // Then: the resize handle is present.
    const handle = screen.getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute('aria-label', 'Resize sidebar');
  });

  it('updates sidebar width on drag', () => {
    // Given: the sidebar is rendered.
    render(<Sidebar />);
    const handle = screen.getByRole('separator');
    const aside = screen.getByRole('complementary');

    // Mock the bounding client rect of the parent aside.
    vi.spyOn(aside, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: SIDEBAR_DEFAULT_WIDTH,
      bottom: 800,
      width: SIDEBAR_DEFAULT_WIDTH,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // When: the user clicks the handle and moves the mouse.
    fireEvent.mouseDown(handle);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));

    // Then: the store's width is updated.
    expect(useUiStore.getState().sidebarWidth).toBe(350);

    // When: the user drags to a value below minimum.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 }));

    // Then: the store's width is clamped to minimum.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);

    // When: the user drags to a value above maximum.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9999 }));

    // Then: the store's width is clamped to maximum.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);

    // When: the user releases the mouse.
    window.dispatchEvent(new MouseEvent('mouseup'));

    // And when: the user moves the mouse again.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));

    // Then: the width does not change because the drag ended.
    expect(useUiStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('aborts the drag listener when the sidebar unmounts mid-drag', () => {
    // Given: the sidebar is rendered and a drag is in progress.
    const { unmount } = render(<Sidebar />);
    const handle = screen.getByRole('separator');
    const aside = screen.getByRole('complementary');

    vi.spyOn(aside, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: SIDEBAR_DEFAULT_WIDTH,
      bottom: 800,
      width: SIDEBAR_DEFAULT_WIDTH,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(handle);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
    expect(useUiStore.getState().sidebarWidth).toBe(300);

    // When: the sidebar unmounts before mouseup, then mousemove fires again.
    unmount();
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 360 }));

    // Then: the width is not updated because the drag listener was aborted.
    expect(useUiStore.getState().sidebarWidth).toBe(300);
  });
});
