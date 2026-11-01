import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_APP_SETTINGS } from '../../../../shared/settings-defaults';
import type { Workspace } from '../../../../shared/types';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { OpenProjectPalette } from './OpenProjectPalette';

const { setActiveWorkspaceId } = vi.hoisted(() => ({
  setActiveWorkspaceId: vi.fn((_id: string | null) => Promise.resolve()),
}));

vi.mock('../../stores/workspaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/workspaceStore')>();
  // Inject the API instead of stubbing `window.api`: debounced persistence can fire after a
  // test's cleanup, and the store must not read a preload global that no longer exists.
  return {
    ...actual,
    useWorkspaceStore: actual.createWorkspaceStore({
      workspaceApi: {
        list: vi.fn(() => Promise.resolve({ workspaces: [], activeWorkspaceId: null })),
        get: vi.fn(() => Promise.resolve(null)),
        create: vi.fn(() => Promise.reject(new Error('Not used by these tests'))),
        update: vi.fn(() => Promise.resolve()),
        move: vi.fn(() => Promise.resolve()),
        delete: vi.fn(() => Promise.resolve()),
        setActiveWorkspaceId,
      },
    }),
  };
});

function workspace(overrides: Partial<Workspace> & Pick<Workspace, 'id' | 'name'>): Workspace {
  return {
    kind: 'project',
    isOpen: true,
    rootPath: `/work/${overrides.id}`,
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const home = workspace({ id: 'home', name: 'Default', kind: 'home', rootPath: '/Users/tester' });
const api = workspace({ id: 'api', name: 'api' });
const initialUi = useUiStore.getState();

function renderPalette(): HTMLElement {
  render(
    <>
      <button type="button">Origin</button>
      <OpenProjectPalette />
    </>,
  );
  const origin = screen.getByRole('button', { name: 'Origin' });
  origin.focus();
  act(() => useUiStore.getState().openProjectPalette());
  return origin;
}

describe('OpenProjectPalette', () => {
  beforeEach(() => {
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS, isLoading: false, error: null });
    useWorkspaceStore.setState({
      workspaces: [home, api],
      activeWorkspaceId: home.id,
      isLoading: false,
      error: null,
    });
    useUiStore.setState({ ...initialUi, activeView: 'workspace' }, true);
  });

  afterEach(() => {
    setActiveWorkspaceId.mockClear();
    vi.restoreAllMocks();
    useUiStore.setState(initialUi, true);
  });

  it('activates the selected project and hands focus to the terminal', async () => {
    // Given: an open palette listing an open, inactive project.
    const origin = renderPalette();
    const restore = vi.spyOn(origin, 'focus');
    const terminalFocusRequest = useUiStore.getState().terminalFocusRequest;

    // When: the project is chosen with Enter.
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    });

    // Then: the project becomes active, the palette closes, and the terminal rather than the
    // previous focus owner receives focus.
    expect(setActiveWorkspaceId).toHaveBeenCalledWith(api.id);
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(api.id);
    expect(useUiStore.getState().projectPaletteOpen).toBe(false);
    expect(useUiStore.getState().terminalFocusRequest).toBe(terminalFocusRequest + 1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('reports a failed selection and allows a retry', async () => {
    // Given: activating the project fails once.
    setActiveWorkspaceId.mockRejectedValueOnce(new Error('Store unavailable'));
    renderPalette();

    // When: the project is chosen.
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /api/ }));
    });

    // Then: the palette stays open with the error and is no longer busy.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to open project: Store unavailable',
    );
    expect(useUiStore.getState().projectPaletteOpen).toBe(true);
    expect(screen.getByRole('option', { name: /api/ })).toBeEnabled();

    // When: the project is chosen again.
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /api/ }));
    });

    // Then: the retry succeeds and closes the palette.
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(api.id);
    expect(useUiStore.getState().projectPaletteOpen).toBe(false);
  });

  it('routes an empty candidate list to Projects settings', () => {
    // Given: no registered directories and no project workspaces.
    useWorkspaceStore.setState({ workspaces: [home] });
    const origin = renderPalette();
    const restore = vi.spyOn(origin, 'focus');
    expect(screen.getByText('No projects registered yet')).toBeInTheDocument();

    // When: the empty-state link is used.
    fireEvent.click(screen.getByRole('button', { name: 'Open Projects settings' }));

    // Then: Settings opens on Projects without pulling focus back to the origin.
    expect(useUiStore.getState().activeView).toBe('settings');
    expect(useUiStore.getState().settingsSection).toBe('projects');
    expect(useUiStore.getState().projectPaletteOpen).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });

  it('restores the previous focus when dismissed with Escape', () => {
    // Given: an open palette opened from a focused origin.
    const origin = renderPalette();
    expect(screen.getByRole('combobox')).toHaveFocus();

    // When: Escape dismisses the palette.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    // Then: no project is activated and focus returns to the origin.
    expect(setActiveWorkspaceId).not.toHaveBeenCalled();
    expect(useUiStore.getState().projectPaletteOpen).toBe(false);
    expect(origin).toHaveFocus();
  });
});
