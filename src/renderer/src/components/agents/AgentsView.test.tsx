import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { PaneRuntimeInfo, Workspace } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { AgentsView } from './AgentsView';

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
        setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
      },
    }),
  };
});
vi.mock('../../stores/paneInfoStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/paneInfoStore')>();
  return { ...actual, usePaneInfoStore: actual.createPaneInfoStore() };
});
vi.mock('./AgentTerminalPanel', () => ({
  AgentTerminalPanel: ({
    onClose,
    onOpenWorkspace,
    onFocusCapture,
  }: {
    onClose: () => void;
    onOpenWorkspace: () => void;
    onFocusCapture: () => void;
  }) => (
    <section aria-label="Selected agent terminal" onFocusCapture={onFocusCapture}>
      <button type="button" onClick={onClose}>
        Close agent terminal
      </button>
      <button type="button" onClick={onOpenWorkspace}>
        Open in workspace
      </button>
    </section>
  ),
}));

const workspace1: Workspace = {
  id: 'workspace-1',
  name: 'Default',
  kind: 'home',
  isOpen: true,
  rootPath: '/Users/tester',
  tabs: [
    {
      id: 'workspace-1-tab-1',
      name: 'zsh',
      isCustomName: false,
      layout: { type: 'leaf', paneId: 'workspace-1-pane-1' },
      activePaneId: 'workspace-1-pane-1',
    },
  ],
  panes: [{ id: 'workspace-1-pane-1', cwd: '/Users/tester', ptyId: 'pty-1' }],
  activeTabId: 'workspace-1-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

const workspace2: Workspace = {
  id: 'workspace-2',
  name: 'Project',
  kind: 'project',
  isOpen: true,
  rootPath: '/Users/tester/project',
  tabs: [
    {
      id: 'workspace-2-tab-1',
      name: 'server',
      isCustomName: false,
      layout: { type: 'leaf', paneId: 'workspace-2-pane-1' },
      activePaneId: 'workspace-2-pane-1',
    },
  ],
  panes: [{ id: 'workspace-2-pane-1', cwd: '/Users/tester/project/src', ptyId: 'pty-2' }],
  activeTabId: 'workspace-2-tab-1',
  createdAt: 1,
  updatedAt: 1,
};

const workspace3: Workspace = {
  ...workspace2,
  id: 'workspace-3',
  name: 'Third',
  tabs: [
    {
      id: 'tab-3',
      name: 'third-tab',
      isCustomName: false,
      layout: { type: 'leaf', paneId: 'pane-3' },
      activePaneId: 'pane-3',
    },
  ],
  panes: [{ id: 'pane-3', cwd: '/tmp/third', ptyId: 'pty-3' }],
  activeTabId: 'tab-3',
};

function agentInfo(ptyId: string, overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return {
    ptyId,
    processActivity: 'running',
    foregroundSession: { kind: 'other' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    agent: {
      known: 'claude',
      kind: 'claude',
      status: 'running',
      source: 'agent-protocol',
      observedAt: 1000,
    },
    observedAt: 1000,
    ...overrides,
  };
}

describe('AgentsView', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    // jsdom has no layout or scrolling implementation.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    useWorkspaceStore.setState({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: workspace1.id,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({
      activeView: 'agents',
      launchPaletteOpen: false,
      projectPaletteOpen: false,
      tabSearchOpen: false,
      pendingAgentSelectionPaneId: null,
      agentCursorPaneId: null,
    });
  });

  afterEach(() => {
    scrollIntoView.mockClear();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({
      activeView: 'workspace',
      launchPaletteOpen: false,
      pendingAgentSelectionPaneId: null,
      agentCursorPaneId: null,
    });
  });

  it('opens launch from the header and an unmodified N on the list', () => {
    // Given: an empty, focused agents list.
    render(<AgentsView />);
    // When: the header button is clicked.
    fireEvent.click(screen.getByRole('button', { name: 'Launch agent' }));
    // Then: launch opens; after dismissal, N offers the same action.
    expect(useUiStore.getState().launchPaletteOpen).toBe(true);
    act(() => useUiStore.getState().closeLaunchPalette());
    fireEvent.keyDown(screen.getByLabelText('Agent sessions'), { key: 'n', isComposing: true });
    expect(useUiStore.getState().launchPaletteOpen).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('Agent sessions'), { key: 'n', ctrlKey: true });
    expect(useUiStore.getState().launchPaletteOpen).toBe(false);
    fireEvent.keyDown(screen.getByLabelText('Agent sessions'), { key: 'n' });
    expect(useUiStore.getState().launchPaletteOpen).toBe(true);
  });

  it('waits for a PTY while retaining the current ended-agent selection', () => {
    // Given: a selected agent whose runtime information then disappears.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { pressed: false, name: /zsh/ }));
    const paneId = workspace2.panes[0].id;
    // When: a new pane is requested before its PTY exists.
    act(() => {
      usePaneInfoStore.setState({ infosByPtyId: {} });
      useWorkspaceStore.setState({
        workspaces: [
          workspace1,
          { ...workspace2, panes: [{ ...workspace2.panes[0], ptyId: undefined }] },
        ],
      });
      useUiStore.getState().requestAgentSelection(paneId);
    });
    // Then: the previous selected shell remains visible until the new PTY is ready.
    expect(screen.getByRole('button', { pressed: true, name: /zsh/ })).toBeInTheDocument();
    expect(useUiStore.getState().pendingAgentSelectionPaneId).toBe(paneId);
    // When: PTY creation completes without an agent hook snapshot yet.
    act(() => useWorkspaceStore.setState({ workspaces: [workspace1, workspace2] }));
    // Then: the requested card is selected and the handoff is consumed.
    expect(screen.getByRole('button', { pressed: true, name: /server/ })).toBeInTheDocument();
    expect(useUiStore.getState().pendingAgentSelectionPaneId).toBeNull();
    expect(useUiStore.getState().agentCursorPaneId).toBe(paneId);
  });

  it('discards pending selection when its workspace closes before PTY creation', () => {
    // Given: a pending request for a pane without a PTY.
    useWorkspaceStore.setState({
      workspaces: [
        workspace1,
        { ...workspace2, panes: [{ ...workspace2.panes[0], ptyId: undefined }] },
      ],
    });
    useUiStore.getState().requestAgentSelection(workspace2.panes[0].id);
    render(<AgentsView />);
    // When: the workspace is closed.
    act(() => useWorkspaceStore.getState().closeWorkspace(workspace2.id));
    // Then: no pending request can select the later stale PTY.
    expect(useUiStore.getState().pendingAgentSelectionPaneId).toBeNull();
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { key: 'ArrowDown', endpoint: /zsh/ },
    { key: 'ArrowUp', endpoint: /server/ },
  ])('moves from the initial cursor and clamps at an endpoint with $key', ({ key, endpoint }) => {
    // Given: the first card has focus and no preview is open.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    expect(screen.getByRole('button', { name: /server/ })).toHaveFocus();
    expect(screen.getByText(/In the list:/)).toHaveTextContent('Space Toggle preview');

    // When: arrows reach and attempt to pass an endpoint.
    fireEvent.keyDown(document.activeElement as Element, { key });
    const card = screen.getByRole('button', { name: endpoint });
    fireEvent.keyDown(card, { key });

    // Then: the cursor is clamped without opening a preview.
    expect(card).toHaveFocus();
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card);
    expect(useUiStore.getState().agentCursorPaneId).toBe(card.dataset.agentPaneId);
  });

  it('moves focus between cards without opening the terminal panel', () => {
    // Given: two sessions and a focused list.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    const list = screen.getByLabelText('Agent sessions');

    // When: ArrowDown is pressed twice.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('button', { name: /server/ }), {
      key: 'ArrowDown',
    });

    // Then: the last card, in the home group after the project group, has focus, and no session
    // is selected or previewed.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
  });

  it('starts list-level navigation from the cursor independently of the preview', () => {
    // Given: three rows, with the last one previewed and the cursor on the first. Three rows are
    // required: with two, stepping from either end reaches the same card.
    useWorkspaceStore.setState({ workspaces: [workspace1, workspace2, workspace3] });
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': agentInfo('pty-1'),
        'pty-2': agentInfo('pty-2'),
        'pty-3': agentInfo('pty-3'),
      },
    });
    render(<AgentsView />);
    const last = screen.getByRole('button', { name: /zsh/ });
    fireEvent.click(last);
    const list = screen.getByLabelText('Agent sessions');
    act(() => screen.getByRole('button', { name: /server/ }).focus());

    // When: ArrowDown reaches the list container itself.
    fireEvent.keyDown(list, { key: 'ArrowDown' });

    // Then: navigation steps from the cursor rather than clamping at the previewed last row.
    expect(screen.getByRole('button', { name: /third-tab/ })).toHaveFocus();
    expect(last).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the focused card in its workspace on Enter', () => {
    // Given: a focused, unselected session in another workspace.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } });
    render(<AgentsView />);
    const card = screen.getByRole('button', { name: /server/ });
    card.focus();

    // When: Enter is pressed on the card.
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(card, event);

    // Then: the native button click is suppressed and workspace navigation completes.
    expect(event.defaultPrevented).toBe(true);
    expect(useUiStore.getState().activeView).toBe('workspace');
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe(workspace2.id);
    expect(state.workspaces[1].activeTabId).toBe(workspace2.activeTabId);
    expect(state.workspaces[1].tabs[0].activePaneId).toBe(workspace2.panes[0].id);
  });

  it('opens the selected session in its workspace on Enter from the list', () => {
    // Given: a selected session in another workspace, with focus on the list container.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /server/ }));
    const list = screen.getByLabelText('Agent sessions');
    list.focus();

    // When: Enter is pressed on the list.
    fireEvent.keyDown(list, { key: 'Enter' });

    // Then: navigation targets the selected session.
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspace2.id);
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])('ignores modified or composing navigation: %j', (options) => {
    // Given: a focused list with one session.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    const list = screen.getByLabelText('Agent sessions');

    // When: a modified arrow or Enter reaches the list.
    fireEvent.keyDown(list, { key: 'ArrowDown', ...options });
    // Cmd+Enter is a supported view shortcut and has its own coverage.
    if (!('metaKey' in options)) fireEvent.keyDown(list, { key: 'Enter', ...options });

    // Then: neither focus movement nor navigation occurs.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(useUiStore.getState().activeView).toBe('agents');
  });

  it.each([
    {
      source: 'an already-prevented event',
      dispatch: (card: HTMLElement): void => {
        const event = new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        });
        event.preventDefault();
        fireEvent(card, event);
      },
    },
    {
      source: 'an editable descendant',
      dispatch: (card: HTMLElement): void => {
        const input = document.createElement('input');
        card.appendChild(input);
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        input.remove();
      },
    },
    {
      source: 'outside the list',
      dispatch: (): void => {
        fireEvent.keyDown(window, { key: 'ArrowDown' });
      },
    },
  ])('ignores navigation keys from $source', ({ dispatch }) => {
    // Given: a focused card with one session.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);

    // When: ArrowDown arrives from an excluded source.
    dispatch(screen.getByRole('button', { name: /zsh/ }));

    // Then: focus remains on the initial card.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('handles Space to repeatedly toggle the preview while retaining card focus', () => {
    // Given: a focused card.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    const card = screen.getByRole('button', { name: /zsh/ });
    card.focus();

    // When: Space is pressed on the card.
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    fireEvent(card, event);

    // Then: native activation is suppressed and the preview opens.
    expect(event.defaultPrevented).toBe(true);
    expect(card).toHaveAttribute('aria-pressed', 'true');

    // When: Space closes and reopens the preview.
    fireEvent.keyDown(card, { key: ' ' });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(card).toHaveFocus();
    fireEvent.keyDown(card, { key: ' ' });

    // Then: the same card stays focused and its preview opens again.
    expect(card).toHaveFocus();
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores Space auto-repeat while still suppressing native activation', () => {
    // Given: a focused card whose preview was opened by Space.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    const card = screen.getByRole('button', { name: /zsh/ });
    fireEvent.keyDown(card, { key: ' ' });

    // When: the held key auto-repeats.
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(card, event);

    // Then: the preview stays open and the button is not activated natively.
    expect(event.defaultPrevented).toBe(true);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not intercept keys from the terminal panel controls', () => {
    // Given: a selected session whose panel close button has focus.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    const card = screen.getByRole('button', { name: /zsh/ });
    fireEvent.click(card);
    const close = screen.getByRole('button', { name: 'Close agent terminal' });
    close.focus();

    // When: navigation keys are pressed on the panel button.
    fireEvent.keyDown(close, { key: 'ArrowUp' });
    fireEvent.keyDown(close, { key: 'Enter' });

    // Then: the list neither moves focus nor navigates away.
    expect(close).toHaveFocus();
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(useUiStore.getState().activeView).toBe('agents');
  });

  it('opens the selected session in its workspace on Cmd+Enter from the agent terminal', () => {
    // Given: a selected session whose terminal panel holds focus, standing in for xterm's textarea.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /server/ }));
    const panel = screen.getByRole('region', { name: 'Selected agent terminal' });
    const terminalInput = document.createElement('textarea');
    panel.append(terminalInput);
    terminalInput.focus();
    const terminalKeyDown = vi.fn();
    terminalInput.addEventListener('keydown', terminalKeyDown);

    // When: Cmd+Enter is pressed inside the terminal.
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(terminalInput, event);

    // Then: the view navigates to the session and the key never reaches the terminal.
    expect(event.defaultPrevented).toBe(true);
    expect(terminalKeyDown).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspace2.id);
  });

  it('opens the focused card over the selected session on Cmd+Enter', () => {
    // Given: one session selected while focus rests on another card.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /zsh/ }));
    screen.getByRole('button', { name: /server/ }).focus();

    // When: Cmd+Enter is pressed.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter', metaKey: true });

    // Then: the focused card wins, matching the plain Enter behavior.
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspace2.id);
  });

  it('opens the cursor card on Cmd+Enter without a preview', () => {
    // Given: a new visit, where the first card holds focus and no preview is open.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();

    // When: Cmd+Enter is pressed on the view's initial focus.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter', metaKey: true });

    // Then: the cursor row opens in its workspace.
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(workspace2.id);
  });

  it('leaves Cmd+Enter alone when it originates outside the view', () => {
    // Given: a selected session while focus sits in an input outside the view, like a sidebar
    // rename field.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /server/ }));
    const outsideInput = document.createElement('input');
    document.body.append(outsideInput);
    outsideInput.focus();

    // When: Cmd+Enter is pressed in that input.
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(outsideInput, event);

    // Then: the key reaches the input and the view stays.
    expect(event.defaultPrevented).toBe(false);
    expect(useUiStore.getState().activeView).toBe('agents');
    outsideInput.remove();
  });

  it.each([
    {
      label: 'no session',
      setup: (): void => {
        act(() => usePaneInfoStore.setState({ infosByPtyId: {} }));
      },
    },
    {
      label: 'an open picker',
      setup: (): void => {
        fireEvent.click(screen.getByRole('button', { name: /server/ }));
        act(() => useUiStore.setState({ launchPaletteOpen: true }));
      },
    },
  ])('leaves Cmd+Enter alone with $label', ({ setup }) => {
    // Given: a session that may be selected, and the given blocking condition.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } });
    render(<AgentsView />);
    setup();

    // When: Cmd+Enter is pressed.
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(screen.getByLabelText('Agent sessions'), event);

    // Then: the key passes through and the view stays.
    expect(event.defaultPrevented).toBe(false);
    expect(useUiStore.getState().activeView).toBe('agents');
  });

  it('leaves empty-list and settings-button keys alone', () => {
    // Given: an empty view.
    render(<AgentsView />);
    const list = screen.getByLabelText('Agent sessions');
    expect(list).toHaveFocus();

    // When: arrows and Enter are pressed without a session.
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) fireEvent.keyDown(list, { key });
    const button = screen.getByRole('button', { name: 'Open AI Integration settings' });
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    fireEvent(button, event);

    // Then: Enter remains available for native activation of the settings button.
    expect(event.defaultPrevented).toBe(false);
    expect(useUiStore.getState().activeView).toBe('agents');
  });

  it('restores list focus when an unselected focused card disappears', () => {
    // Given: a Tab-focused card without a terminal selection.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    screen.getByRole('button', { name: /zsh/ }).focus();

    // When: agent detection removes that unselected row.
    act(() => usePaneInfoStore.setState({ infosByPtyId: {} }));

    // Then: focus has a durable destination and no terminal is selected.
    expect(screen.getByLabelText('Agent sessions')).toHaveFocus();
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
  });

  it('preserves external focus during polling and pane removal', () => {
    // Given: a selected card followed by focus outside the view.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    const { getByLabelText } = render(
      <>
        <button aria-label="Sidebar control" />
        <AgentsView />
      </>,
    );
    const card = screen.getByRole('button', { name: /zsh/ });
    fireEvent.click(card);
    card.focus();
    const external = getByLabelText('Sidebar control');
    external.focus();

    // When: runtime polling updates, followed by structural removal.
    act(() =>
      usePaneInfoStore.setState({
        infosByPtyId: { 'pty-1': agentInfo('pty-1', { userPrompt: 'Updated' }) },
      }),
    );
    act(() => useWorkspaceStore.setState({ workspaces: [] }));

    // Then: asynchronous updates neither steal external focus nor scroll the list.
    expect(external).toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('renders the activity summary and the submitted prompt on one card', () => {
    // Given: a pane whose agent reported an activity detail and has a recorded prompt.
    const prompt = 'Fix the failing tests';
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': agentInfo('pty-1', {
          agent: {
            known: 'claude',
            kind: 'claude',
            status: 'running',
            source: 'agent-protocol',
            observedAt: 1000,
            detail: { activityLabel: 'Bash: pnpm test' },
          },
          userPrompt: prompt,
        }),
      },
      isLoading: false,
      error: null,
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: both halves of the card are present, which is the pairing the sidebar is too narrow to
    // show. The footer locates the pane so the user can tell identical agents apart.
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Bash: pnpm test')).toBeInTheDocument();
    expect(screen.getByTitle(prompt)).toHaveTextContent(prompt);
    expect(screen.getByText('zsh')).toBeInTheDocument();
  });

  it('renders a multi-line prompt with its line breaks intact', () => {
    // Given: a prompt written as a list, which the tracker preserves the breaks of.
    const prompt = 'Fix three things:\n1. lint fights Prettier\n2. two tests fail';
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1', { userPrompt: prompt }) },
      isLoading: false,
      error: null,
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: the row opts into showing the breaks rather than collapsing the list onto one line.
    // The sidebar deliberately does not, since its rows are single-line by design.
    // The default matcher normalizes whitespace, which would erase the very thing under test, so
    // the query keeps the string as written.
    const promptRow = screen.getByTitle(prompt, { normalizer: (value) => value });
    expect(promptRow).toHaveClass('whitespace-pre-line');
    expect(promptRow.textContent).toBe(`❝ ${prompt}`);
  });

  it('says so explicitly when a session has no prompt recorded', () => {
    // Given: an agent detected without a prompt — an Antigravity session, or one whose hook is not
    // configured to report prompts.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1') },
      isLoading: false,
      error: null,
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: the row states the absence rather than leaving a blank space, which would read as a
    // rendering glitch in a list where neighbouring rows do show a prompt.
    expect(screen.getByText('No prompt captured for this session')).toBeInTheDocument();
  });

  it('labels the status badge exactly as the Workspaces sidebar does', () => {
    // Given: one agent awaiting input and one processing a turn.
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': agentInfo('pty-1', {
          agent: {
            known: 'claude',
            kind: 'claude',
            status: 'awaiting-input',
            source: 'agent-protocol',
            observedAt: 1000,
          },
        }),
        'pty-2': agentInfo('pty-2'),
      },
      isLoading: false,
      error: null,
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: the badge text comes from the shared indicator helper, so the two surfaces cannot
    // describe the same pane differently.
    expect(screen.getByText('awaiting input')).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('opens the selected pane in the workspace only through the explicit action', () => {
    // Given: an agent running in a workspace other than the active one.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-2': agentInfo('pty-2') },
      isLoading: false,
      error: null,
    });
    render(<AgentsView />);

    // When: the card is clicked.
    fireEvent.click(screen.getByRole('button', { name: /server/ }));

    // Then: selection keeps the Agents view and active workspace unchanged.
    expect(useUiStore.getState().activeView).toBe('agents');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('workspace-1');

    // When: the explicit workspace action is used.
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));

    // Then: the workspace, tab and pane are all selected and the main area switches back, so the
    // click lands the user on the terminal they were looking at.
    const workspaceState = useWorkspaceStore.getState();
    expect(workspaceState.activeWorkspaceId).toBe('workspace-2');
    const targetWorkspace = workspaceState.workspaces.find((w) => w.id === 'workspace-2');
    expect(targetWorkspace?.activeTabId).toBe('workspace-2-tab-1');
    expect(targetWorkspace?.tabs[0]?.activePaneId).toBe('workspace-2-pane-1');
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  it('shows an empty state with a route into AI Integration settings when no agent is running', () => {
    // Given: no pane has an agent detected.
    render(<AgentsView />);

    // Then: the view explains why it is empty rather than showing a blank pane.
    expect(screen.getByText('No agents detected')).toBeInTheDocument();

    // When: the settings link is used.
    fireEvent.click(screen.getByRole('button', { name: 'Open AI Integration settings' }));

    // Then: the main area switches to settings, where the hook snippets live.
    expect(useUiStore.getState().activeView).toBe('settings');
  });

  it('keeps clicked previews open, toggles with Space, and clears selection on departure', () => {
    // Given: an agent row in the full-width list.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    const row = screen.getByRole('button', { name: /zsh/ });

    // When: the row is selected.
    fireEvent.click(row);

    // Then: the row is selected and its terminal panel opens.
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Selected agent terminal' })).toBeInTheDocument();

    // When: the user returns from the terminal panel by clicking the selected row.
    act(() => screen.getByRole('button', { name: 'Close agent terminal' }).focus());
    fireEvent.click(row);

    // Then: clicking again keeps the preview open and focuses its card.
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute('aria-pressed', 'true');

    // When: Space closes the preview.
    fireEvent.keyDown(row, { key: ' ' });

    // Then: selection is cleared and the panel closes.
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();

    // When: another selection is followed by departure and a revisit.
    fireEvent.click(row);
    act(() => {
      useUiStore.setState({ activeView: 'settings' });
    });
    act(() => {
      useUiStore.setState({
        activeView: 'agents',
        launchPaletteOpen: false,
        projectPaletteOpen: false,
        tabSearchOpen: false,
        pendingAgentSelectionPaneId: null,
      });
    });

    // Then: the later visit does not restore selection.
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps an ended agent selected until explicitly closed', () => {
    // Given: a selected agent.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /zsh/ }));

    // When: its agent status disappears.
    act(() => {
      usePaneInfoStore.setState({
        infosByPtyId: { 'pty-1': agentInfo('pty-1', { agent: undefined }) },
      });
    });

    // Then: the ended agent remains selected.
    expect(screen.getByText('No agent running')).toBeInTheDocument();

    // When: its runtime snapshot also disappears.
    act(() => {
      usePaneInfoStore.setState({ infosByPtyId: {} });
    });

    // Then: structural selection survives the missing snapshot.
    expect(screen.getByText('Agent status unavailable')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Selected agent terminal' })).toBeInTheDocument();

    // When: the user explicitly closes the selected terminal.
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));

    // Then: the retained row disappears and focus returns to the list.
    expect(screen.getByText('No agents detected')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent sessions')).toHaveFocus();
  });

  it.each(['pane', 'pty'] as const)(
    'clears selection when the selected %s disappears',
    (removed) => {
      // Given: a selected agent pane.
      usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
      render(<AgentsView />);
      fireEvent.click(screen.getByRole('button', { name: /zsh/ }));

      // When: the structural model loses the pane or its PTY.
      act(() => {
        useWorkspaceStore.setState({
          workspaces: [
            {
              ...workspace1,
              panes:
                removed === 'pane'
                  ? []
                  : workspace1.panes.map((pane) => ({ ...pane, ptyId: undefined })),
            },
          ],
        });
      });

      // Then: it no longer holds a terminal selection.
      expect(
        screen.queryByRole('region', { name: 'Selected agent terminal' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('No agents detected')).toBeInTheDocument();
    },
  );

  it('groups cards under workspace headings with projects first and home last', () => {
    // Given: agents in home and a project, plus an open project without agents.
    const idle: Workspace = { ...workspace2, id: 'idle', name: 'Idle', tabs: [], panes: [] };
    useWorkspaceStore.setState({ workspaces: [workspace1, workspace2, idle] });
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: each workspace with agents has a heading naming it and its home-shortened root, in
    // the same order arrow keys follow, and the agentless workspace has no section.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Project ~/project',
      'Default ~',
    ]);
    expect(screen.queryByRole('region', { name: /Idle/ })).not.toBeInTheDocument();
    const project = screen.getByRole('region', { name: 'Project ~/project' });
    expect(within(project).getByRole('button', { name: /server/ })).toBeInTheDocument();
    const home = screen.getByRole('region', { name: 'Default ~' });
    expect(within(home).getByRole('button', { name: /zsh/ })).toBeInTheDocument();
  });

  it('locates each card by tab and workspace-relative cwd without repeating the workspace', () => {
    // Given: a project agent in a subdirectory, a project agent at the root, and a home agent.
    const atRoot: Workspace = {
      ...workspace2,
      id: 'workspace-3',
      name: 'Other',
      rootPath: '/Users/tester/other',
      tabs: [
        {
          id: 'workspace-3-tab-1',
          name: 'root-tab',
          isCustomName: false,
          layout: { type: 'leaf', paneId: 'workspace-3-pane-1' },
          activePaneId: 'workspace-3-pane-1',
        },
      ],
      panes: [{ id: 'workspace-3-pane-1', cwd: '/Users/tester/other', ptyId: 'pty-3' }],
      activeTabId: 'workspace-3-tab-1',
    };
    useWorkspaceStore.setState({ workspaces: [workspace1, workspace2, atRoot] });
    usePaneInfoStore.setState({
      infosByPtyId: {
        'pty-1': agentInfo('pty-1'),
        'pty-2': agentInfo('pty-2'),
        'pty-3': agentInfo('pty-3'),
      },
    });

    // When: the agents view renders.
    render(<AgentsView />);

    // Then: cards show the tab and cwd relative to the heading, the project root is omitted, and
    // home keeps its root as `~`.
    const subdirectory = screen.getByRole('button', { name: /server/ });
    expect(within(subdirectory).getByTitle('/Users/tester/project/src')).toHaveTextContent('src');
    expect(subdirectory).not.toHaveTextContent('Project');
    const root = screen.getByRole('button', { name: /root-tab/ });
    expect(within(root).queryByTitle('/Users/tester/other')).not.toBeInTheDocument();
    const homeCard = screen.getByRole('button', { name: /zsh/ });
    expect(within(homeCard).getByTitle('/Users/tester')).toHaveTextContent('~');

    // When: a terminal panel opens and the list becomes compact.
    fireEvent.click(subdirectory);

    // Then: compact cards keep the tab but drop the cwd line.
    expect(within(subdirectory).getByText('server')).toBeInTheDocument();
    expect(within(subdirectory).queryByTitle('/Users/tester/project/src')).not.toBeInTheDocument();
  });

  it('restores the cursor card from blank list space without changing the preview', () => {
    // Given: one preview and a different cursor card.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    const preview = screen.getByRole('button', { name: /server/ });
    const cursor = screen.getByRole('button', { name: /zsh/ });
    fireEvent.click(preview);
    act(() => cursor.focus());

    // When: blank list space receives focus.
    act(() => screen.getByLabelText('Agent sessions').focus());

    // Then: focus returns to the cursor while the original preview stays open.
    expect(cursor).toHaveFocus();
    expect(preview).toHaveAttribute('aria-pressed', 'true');
    expect(useUiStore.getState().agentCursorPaneId).toBe(cursor.dataset.agentPaneId);
  });

  it('aligns the cursor with the preview when terminal focus returns', () => {
    // Given: a preview with the cursor moved to another card.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    const preview = screen.getByRole('button', { name: /server/ });
    fireEvent.click(preview);
    act(() => screen.getByRole('button', { name: /zsh/ }).focus());
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace1.panes[0].id);
    const input = document.createElement('textarea');
    screen.getByRole('region', { name: 'Selected agent terminal' }).append(input);

    // When: the user focuses the borrowed terminal.
    act(() => input.focus());

    // Then: the cursor follows the preview without disturbing terminal focus.
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace2.panes[0].id);
    expect(input).toHaveFocus();

    // When: the close button is activated.
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));

    // Then: focus returns to that card.
    expect(preview).toHaveFocus();
    expect(preview).toHaveAttribute('aria-pressed', 'false');
  });

  it('recovers focus at the same position when the cursor row disappears', () => {
    // Given: the first of two sessions holds cursor and focus, without a preview.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    expect(screen.getByRole('button', { name: /server/ })).toHaveFocus();

    // When: that agent stops running.
    act(() => usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } }));

    // Then: the remaining card at the same position gets focus and cursor.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace1.panes[0].id);
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('focuses a surviving card after closing an ended preview removes its row', () => {
    // Given: an ended preview retained alongside one running agent.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /server/ }));
    act(() => usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } }));
    act(() => screen.getByRole('button', { name: 'Close agent terminal' }).focus());

    // When: the preview closes and its retained row disappears.
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));

    // Then: the remaining session receives focus and the cursor, with no preview.
    expect(screen.queryByRole('button', { name: /server/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace1.panes[0].id);
  });

  it('initializes and clears the cursor for each visit under StrictMode', () => {
    // Given: two agent sessions and development effect replay.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(
      <StrictMode>
        <AgentsView />
      </StrictMode>,
    );
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace2.panes[0].id);
    act(() => screen.getByRole('button', { name: /zsh/ }).focus());

    // When: the view is left and reopened.
    act(() => useUiStore.getState().openSettings());
    expect(useUiStore.getState().agentCursorPaneId).toBeNull();
    act(() => useUiStore.getState().openAgents());

    // Then: the new visit starts at the first card with no preview.
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace2.panes[0].id);
    expect(screen.getByRole('button', { name: /server/ })).toHaveFocus();
    expect(screen.queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('focuses the first arriving session only when the empty list still has focus', () => {
    // Given: an empty list has the initial focus.
    render(<AgentsView />);
    expect(screen.getByLabelText('Agent sessions')).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBeNull();

    // When: the first agent is detected.
    act(() => usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } }));

    // Then: the list yields focus to the new cursor card.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace1.panes[0].id);

    // When: focus is outside the view while the list empties and fills again.
    const external = document.createElement('input');
    document.body.append(external);
    act(() => external.focus());
    act(() => usePaneInfoStore.setState({ infosByPtyId: {} }));
    act(() => usePaneInfoStore.setState({ infosByPtyId: { 'pty-2': agentInfo('pty-2') } }));

    // Then: cursor initialization does not steal external focus.
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace2.panes[0].id);
    expect(external).toHaveFocus();
    external.remove();
  });

  it('recovers focus when a picker closes after its originating card disappeared', () => {
    // Given: a picker holds focus after being opened from the first of two cards.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    const pickerInput = document.createElement('input');
    document.body.append(pickerInput);
    act(() => {
      useUiStore.setState({ launchPaletteOpen: true });
      pickerInput.focus();
    });

    // When: the originating card disappears behind the picker, which then closes.
    act(() => usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } }));
    expect(pickerInput).toHaveFocus();
    act(() => {
      pickerInput.remove();
      useUiStore.setState({ launchPaletteOpen: false });
    });

    // Then: focus lands on the surviving cursor card instead of the body.
    expect(screen.getByRole('button', { name: /zsh/ })).toHaveFocus();
  });

  it('scrolls the cursor card into view when a closed preview returns focus to it', () => {
    // Given: a card with an open preview, and no scrolling for the initial focus.
    usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': agentInfo('pty-1') } });
    render(<AgentsView />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    const card = screen.getByRole('button', { name: /zsh/ });
    fireEvent.keyDown(card, { key: ' ' });

    // When: Space closes the preview and the list reflows.
    fireEvent.keyDown(card, { key: ' ' });

    // Then: the focused card is kept visible.
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card);
  });

  it('returns from the close button to the cursor without changing it to the preview', () => {
    // Given: the cursor has moved away from the preview.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': agentInfo('pty-1'), 'pty-2': agentInfo('pty-2') },
    });
    render(<AgentsView />);
    fireEvent.click(screen.getByRole('button', { name: /server/ }));
    const cursor = screen.getByRole('button', { name: /zsh/ });
    act(() => cursor.focus());

    // When: close is activated without an intervening panel focus event.
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));

    // Then: the cursor card retains focus and the preview closes.
    expect(cursor).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBe(workspace1.panes[0].id);
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      removedPtyId: 'pty-3',
      cursorName: /third-tab/,
      expectedName: /zsh/,
      expectedId: workspace1.panes[0].id,
    },
    {
      removedPtyId: 'pty-1',
      cursorName: /zsh/,
      expectedName: /third-tab/,
      expectedId: workspace3.panes[0].id,
    },
  ])(
    'preserves the fallback position across render retries when $removedPtyId disappears',
    ({ removedPtyId, cursorName, expectedName, expectedId }) => {
      // Given: three rows and a cursor beyond the first position.
      useWorkspaceStore.setState({ workspaces: [workspace1, workspace2, workspace3] });
      usePaneInfoStore.setState({
        infosByPtyId: {
          'pty-1': agentInfo('pty-1'),
          'pty-2': agentInfo('pty-2'),
          'pty-3': agentInfo('pty-3'),
        },
      });
      render(
        <StrictMode>
          <AgentsView />
        </StrictMode>,
      );
      act(() => screen.getByRole('button', { name: cursorName }).focus());

      // When: the cursor row disappears and the resolved cursor is synchronized to the store.
      act(() =>
        usePaneInfoStore.setState({
          infosByPtyId: Object.fromEntries(
            ['pty-1', 'pty-2', 'pty-3']
              .filter((id) => id !== removedPtyId)
              .map((id) => [id, agentInfo(id)]),
          ),
        }),
      );

      // Then: both cursor and focus use the same position, clamping at the last surviving row.
      expect(useUiStore.getState().agentCursorPaneId).toBe(expectedId);
      expect(screen.getByRole('button', { name: expectedName })).toHaveFocus();
    },
  );
});
