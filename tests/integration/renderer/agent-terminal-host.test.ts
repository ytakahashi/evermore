import { createElement, StrictMode, useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { PaneRuntimeInfo, Workspace } from '../../../src/shared/types';
import { AgentsView } from '../../../src/renderer/src/components/agents/AgentsView';
import { useWorkspaceStore } from '../../../src/renderer/src/stores/workspaceStore';
import { usePaneInfoStore } from '../../../src/renderer/src/stores/paneInfoStore';
import { useUiStore } from '../../../src/renderer/src/stores/uiStore';
import {
  terminalHostRegistry,
  type TerminalHostHandle,
} from '../../../src/renderer/src/terminal-host/terminalHostRegistry';

vi.mock('../../../src/renderer/src/stores/workspaceStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/src/stores/workspaceStore')>();
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
vi.mock('../../../src/renderer/src/stores/paneInfoStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/renderer/src/stores/paneInfoStore')>();
  return { ...actual, usePaneInfoStore: actual.createPaneInfoStore() };
});

const workspace: Workspace = {
  id: 'ws',
  name: 'Project',
  kind: 'project',
  isOpen: true,
  rootPath: '/tmp',
  activeTabId: 'tab',
  createdAt: 0,
  updatedAt: 0,
  tabs: [
    {
      id: 'tab',
      name: 'shell',
      isCustomName: false,
      activePaneId: 'p1',
      layout: {
        type: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        children: [
          { type: 'leaf', paneId: 'p1' },
          { type: 'leaf', paneId: 'p2' },
        ],
      },
    },
  ],
  panes: [
    { id: 'p1', cwd: '/tmp', ptyId: 'pty-1' },
    { id: 'p2', cwd: '/tmp', ptyId: 'pty-2' },
  ],
};

function info(ptyId: string, known: 'claude' | 'codex'): PaneRuntimeInfo {
  return {
    ptyId,
    processActivity: 'running',
    foregroundSession: { kind: 'other' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    observedAt: 1,
    agent: { known, kind: known, status: 'running', source: 'agent-protocol', observedAt: 1 },
  };
}

const cleanups: (() => void)[] = [];
function register(paneId: string): TerminalHostHandle {
  const home = document.createElement('div');
  const element = document.createElement('div');
  element.className = 'xterm';
  const input = document.createElement('textarea');
  element.appendChild(input);
  home.appendChild(element);
  document.body.appendChild(home);
  const handle = { home, element, fit: vi.fn(), focus: vi.fn(() => input.focus()) };
  const unregister = terminalHostRegistry.register(paneId, handle);
  cleanups.push(() => {
    unregister();
    element.remove();
    home.remove();
  });
  return handle;
}

function row(agent: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(agent) });
}

describe('Agents view terminal borrowing', () => {
  beforeEach(() => {
    // jsdom has no layout or scrolling implementation.
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: 'ws',
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': info('pty-1', 'claude'), 'pty-2': info('pty-2', 'codex') },
    });
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
    cleanup();
    for (const dispose of cleanups.splice(0)) dispose();
    useUiStore.setState({
      activeView: 'workspace',
      launchPaletteOpen: false,
      pendingAgentSelectionPaneId: null,
    });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  });

  it('focuses the borrowed terminal on Enter and moves back and forth with Command arrows', () => {
    // Given: a registered terminal and a focused agent card.
    const terminal = register('p1');
    render(createElement(AgentsView));
    const card = row('Claude');
    act(() => card.focus());
    const input = terminal.element.querySelector('textarea')!;
    const terminalKeyDown = vi.fn();
    input.addEventListener('keydown', terminalKeyDown);

    // When: Enter opens the preview and focuses the borrowed terminal.
    fireEvent.keyDown(card, { key: 'Enter' });

    // Then: focus is inside the panel and workspace navigation has not happened.
    expect(input).toHaveFocus();
    expect(useUiStore.getState().activeView).toBe('agents');
    expect(terminal.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();

    // When: Command+Left returns to the list.
    fireEvent.keyDown(input, { key: 'ArrowLeft', metaKey: true });

    // Then: the preview stays open and xterm never receives the chord.
    expect(card).toHaveFocus();
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(terminalKeyDown).not.toHaveBeenCalled();

    // When: the cursor moves away and Command+Right returns to the preview.
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', metaKey: true });

    // Then: terminal focus realigns the cursor, and N remains terminal input.
    expect(input).toHaveFocus();
    expect(useUiStore.getState().agentCursorPaneId).toBe('p1');
    fireEvent.keyDown(input, { key: 'n' });
    expect(useUiStore.getState().launchPaletteOpen).toBe(false);
    expect(terminalKeyDown).toHaveBeenCalledTimes(1);
  });

  it('waits for terminal registration before fulfilling an Enter focus request', () => {
    // Given: a preview request before xterm is registered.
    render(createElement(AgentsView));
    fireEvent.keyDown(row('Claude'), { key: 'Enter' });
    let terminal!: TerminalHostHandle;

    // When: the owner registers its terminal later.
    act(() => {
      terminal = register('p1');
    });

    // Then: borrowing completes before focus is applied.
    expect(terminal.element.querySelector('textarea')).toHaveFocus();
    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it('keeps a held Enter out of the terminal until a new key press', () => {
    // Given: Enter moved focus from a card into the borrowed terminal.
    const terminal = register('p1');
    render(createElement(AgentsView));
    const card = row('Claude');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'Enter' });
    const input = terminal.element.querySelector('textarea')!;
    const terminalKeyDown = vi.fn();
    input.addEventListener('keydown', terminalKeyDown);

    // When: OS key repeat delivers the held Enter to the terminal.
    const repeated = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, repeated);

    // Then: xterm never sees the repeat.
    expect(repeated.defaultPrevented).toBe(true);
    expect(terminalKeyDown).not.toHaveBeenCalled();

    // When: the user presses and then holds Enter inside the terminal.
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });

    // Then: both reach the agent as ordinary terminal input.
    expect(terminalKeyDown).toHaveBeenCalledTimes(2);
  });

  it('does not take focus from an input outside the view when the terminal arrives late', () => {
    // Given: a pending focus request and the user typing outside the Agents view.
    render(createElement(AgentsView));
    fireEvent.keyDown(row('Claude'), { key: 'Enter' });
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    cleanups.push(() => outside.remove());
    act(() => outside.focus());
    let terminal!: TerminalHostHandle;

    // When: the owner registers its terminal.
    act(() => {
      terminal = register('p1');
    });

    // Then: the request is dropped and the outside input keeps focus.
    expect(terminal.focus).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
  });

  it('fulfills a late focus request when focus has fallen to the body', () => {
    // Given: a pending focus request and no element holding focus.
    render(createElement(AgentsView));
    fireEvent.keyDown(row('Claude'), { key: 'Enter' });
    act(() => (document.activeElement as HTMLElement).blur());
    let terminal!: TerminalHostHandle;

    // When: the owner registers its terminal.
    act(() => {
      terminal = register('p1');
    });

    // Then: the terminal takes focus because nothing else claimed it.
    expect(terminal.element.querySelector('textarea')).toHaveFocus();
  });

  it.each(['ArrowDown', ' ', 'click', 'close'])(
    'cancels delayed terminal focus after %s',
    (action) => {
      // Given: Enter requested focus while the terminal was unavailable.
      render(createElement(AgentsView));
      const card = row('Claude');
      fireEvent.keyDown(card, { key: 'Enter' });

      // When: the user continues navigating before registration.
      if (action === 'click') fireEvent.click(card);
      else if (action === 'close')
        fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));
      else fireEvent.keyDown(card, { key: action });
      let terminal!: TerminalHostHandle;
      act(() => {
        terminal = register('p1');
      });

      // Then: late registration cannot steal focus.
      expect(terminal.focus).not.toHaveBeenCalled();
      expect(terminal.element.querySelector('textarea')).not.toHaveFocus();
    },
  );

  it('defers launch focus while a modal picker is open', () => {
    // Given: a picker is open when the launched pane becomes ready.
    const terminal = register('p1');
    render(createElement(AgentsView));
    act(() => {
      useUiStore.getState().openLaunchPalette();
      useUiStore.getState().requestAgentSelection('p1');
    });

    // Then: the request selects the session without focusing behind the modal.
    expect(row('Claude')).toHaveAttribute('aria-pressed', 'true');
    expect(terminal.focus).not.toHaveBeenCalled();

    // When: the picker closes.
    act(() => useUiStore.getState().closeLaunchPalette());

    // Then: launch focus reaches the newly borrowed terminal.
    expect(terminal.element.querySelector('textarea')).toHaveFocus();
  });

  it.each(['outside', 'picker', 'composition', 'prevented'])(
    'ignores Command arrows for %s events',
    (source) => {
      // Given: an open preview with terminal focus.
      const terminal = register('p1');
      render(createElement(AgentsView));
      fireEvent.keyDown(row('Claude'), { key: 'Enter' });
      const input = terminal.element.querySelector('textarea')!;
      if (source === 'picker') act(() => useUiStore.getState().openLaunchPalette());
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        metaKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: source === 'composition',
      });
      if (source === 'prevented') event.preventDefault();

      // When: the excluded chord arrives.
      fireEvent(source === 'outside' ? document.body : input, event);

      // Then: focus stays on the terminal and no new interception occurs.
      expect(input).toHaveFocus();
      expect(event.defaultPrevented).toBe(source === 'prevented');
    },
  );

  it.each([
    { key: 'ArrowLeft', source: 'card' },
    { key: 'ArrowRight', source: 'terminal' },
  ] as const)('leaves Command+$key from the $source alone', ({ key, source }) => {
    // Given: an open preview and focus on the surface that must retain this chord.
    const terminal = register('p1');
    render(createElement(AgentsView));
    const card = row('Claude');
    fireEvent.keyDown(card, { key: 'Enter' });
    const input = terminal.element.querySelector('textarea')!;
    const target = source === 'card' ? card : input;
    act(() => target.focus());
    const targetKeyDown = vi.fn();
    target.addEventListener('keydown', targetKeyDown);

    // When: the chord points toward the surface that already has focus.
    const event = new KeyboardEvent('keydown', {
      key,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(target, event);

    // Then: native handling receives the chord without interception or a focus change.
    expect(event.defaultPrevented).toBe(false);
    expect(targetKeyDown).toHaveBeenCalledOnce();
    expect(target).toHaveFocus();
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('leaves Command+Right alone without a preview', () => {
    // Given: a focused list card without an open terminal panel.
    render(createElement(AgentsView));
    const card = row('Claude');
    act(() => card.focus());

    // When: Command+Right is pressed.
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(card, event);

    // Then: no preview or focus request is created.
    expect(card).toHaveFocus();
    expect(event.defaultPrevented).toBe(false);
    expect(
      screen.queryByRole('region', { name: 'Selected agent terminal' }),
    ).not.toBeInTheDocument();
  });

  it('releases a preview when its workspace closes and keeps other sessions usable', () => {
    // Given: a previewable terminal owner and an agent in another workspace.
    const other: Workspace = {
      ...workspace,
      id: 'other',
      activeTabId: 'other-tab',
      tabs: [
        {
          ...workspace.tabs[0]!,
          id: 'other-tab',
          activePaneId: 'p3',
          layout: { type: 'leaf', paneId: 'p3' },
        },
      ],
      panes: [{ id: 'p3', cwd: '/other', ptyId: 'pty-3' }],
    };
    useWorkspaceStore.setState({ workspaces: [workspace, other], activeWorkspaceId: other.id });
    usePaneInfoStore.getState().setInfo(info('pty-3', 'codex'));
    const remaining = register('p3');
    let retiredRoot!: HTMLElement;
    function Owner(): null {
      useEffect(() => {
        const home = document.createElement('div');
        const element = document.createElement('div');
        retiredRoot = element;
        home.appendChild(element);
        document.body.appendChild(home);
        const unregister = terminalHostRegistry.register('p1', {
          home,
          element,
          fit: vi.fn(),
          focus: vi.fn(),
        });
        return () => {
          unregister();
          element.remove();
          home.remove();
        };
      }, []);
      return null;
    }
    function OpenOwner(): ReturnType<typeof createElement> | null {
      const isOpen = useWorkspaceStore(
        (state) => state.workspaces.find((w) => w.id === workspace.id)?.isOpen,
      );
      return isOpen ? createElement(Owner) : null;
    }
    render(createElement('div', null, createElement(OpenOwner), createElement(AgentsView)));
    fireEvent.click(row('Claude'));
    expect(retiredRoot.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    // When: the project closes while its terminal is borrowed.
    act(() => useWorkspaceStore.getState().closeWorkspace(workspace.id));
    // Then: its owner and preview disappear, and the remaining agent can borrow its terminal.
    expect(retiredRoot.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: /Claude/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Selected agent terminal')).not.toBeInTheDocument();
    fireEvent.click(row('Codex'));
    expect(remaining.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    expect(useUiStore.getState().activeView).toBe('agents');
  });

  it('moves focus by keyboard without borrowing and returns a previewed terminal before a pane jump', () => {
    // Given: existing terminal owners and a focused, unselected list.
    const first = register('p1');
    const second = register('p2');
    render(createElement(StrictMode, null, createElement(AgentsView)));
    const list = screen.getByLabelText('Agent sessions');
    const firstRow = row('Claude');
    const secondRow = row('Codex');

    // When: arrows move through both cards.
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });

    // Then: focus reaches the second card while both terminals stay home and unresized.
    expect(secondRow).toHaveFocus();
    expect(first.element.parentElement).toBe(first.home);
    expect(second.element.parentElement).toBe(second.home);
    expect(first.fit).not.toHaveBeenCalled();
    expect(second.fit).not.toHaveBeenCalled();
    expect(terminalHostRegistry.getBorrowedHost()).toBeUndefined();

    // When: Space opens the focused card, and terminal-originated keys bubble.
    fireEvent.keyDown(secondRow, { key: ' ' });
    const input = second.element.querySelector('textarea')!;
    input.focus();
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter']) fireEvent.keyDown(input, { key });

    // Then: only the second terminal is borrowed, and the list ignores the terminal's keys.
    expect(second.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    expect(input).toHaveFocus();
    expect(useUiStore.getState().activeView).toBe('agents');

    // When: Command+Enter is pressed back on the second card.
    secondRow.focus();
    fireEvent.keyDown(secondRow, { key: 'Enter', metaKey: true });

    // Then: navigation selects the other pane in the same tab and returns its original root.
    expect(useWorkspaceStore.getState().workspaces[0].tabs[0].activePaneId).toBe('p2');
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(second.element.parentElement).toBe(second.home);
    expect(terminalHostRegistry.getBorrowedHost()).toBeUndefined();
  });

  it('returns the first root before borrowing another and preserves focus until terminal click', () => {
    // Given: two existing xterm roots and StrictMode lifecycle replay.
    const first = register('p1');
    const second = register('p2');
    render(createElement(StrictMode, null, createElement(AgentsView)));
    row('Claude').focus();
    // When: selection switches between sessions, then Space closes the preview.
    fireEvent.click(row('Claude'));
    expect(first.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    expect(row('Claude')).toHaveFocus();
    fireEvent.click(row('Codex'));
    expect(first.element.parentElement).toBe(first.home);
    expect(second.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    fireEvent.keyDown(row('Codex'), { key: ' ' });
    // Then: both roots return to their original containers.
    expect(second.element.parentElement).toBe(second.home);
    expect(screen.queryByLabelText('Selected agent terminal')).not.toBeInTheDocument();
  });

  it.each(['workspace', 'settings'] as const)(
    'releases on departure to %s and forgets selection',
    (view) => {
      // Given: a selected terminal.
      const terminal = register('p1');
      render(createElement(AgentsView));
      fireEvent.click(row('Claude'));
      // When: another view becomes active through the UI store.
      act(() => {
        useUiStore.setState({ activeView: view });
      });
      // Then: layout cleanup has already restored the terminal before a revisit.
      expect(terminal.element.parentElement).toBe(terminal.home);
      act(() => {
        useUiStore.setState({ activeView: 'agents' });
      });
      expect(screen.queryByLabelText('Selected agent terminal')).not.toBeInTheDocument();
    },
  );

  it('retries late registration and responds to removal without resurrecting disposed DOM', () => {
    // Given: the runtime model exists before its terminal host registration.
    render(createElement(AgentsView));
    fireEvent.click(row('Claude'));
    expect(screen.getByRole('status')).toHaveTextContent('Terminal is unavailable');
    let terminal: TerminalHostHandle | undefined;
    // When: initialization registers the terminal, then its owner disposes it.
    act(() => {
      terminal = register('p1');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(terminal?.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    act(() => {
      cleanups.shift()?.();
    });
    // Then: the panel reports unavailability and stale release cannot reattach the root.
    expect(screen.getByRole('status')).toHaveTextContent('Terminal is unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));
    expect(terminal?.element.parentElement).toBeNull();
  });

  it('keeps the same borrowed root through polling gaps and agent termination', () => {
    // Given: an existing selected terminal.
    const terminal = register('p1');
    render(createElement(AgentsView));
    fireEvent.click(row('Claude'));
    const host = terminal.element.parentElement;
    const fits = vi.mocked(terminal.fit).mock.calls.length;
    // When: runtime snapshots disappear and then report an ordinary shell.
    act(() => {
      usePaneInfoStore.setState({ infosByPtyId: {} });
    });
    act(() => {
      usePaneInfoStore.setState({
        infosByPtyId: { 'pty-1': { ...info('pty-1', 'claude'), agent: undefined } },
      });
    });
    // Then: neither update returns or reborrows the live terminal.
    expect(terminal.element.parentElement).toBe(host);
    expect(terminal.fit).toHaveBeenCalledTimes(fits);
    // When: Space closes the ended preview.
    fireEvent.keyDown(screen.getByRole('button', { name: /No agent running/ }), { key: ' ' });
    // Then: the terminal returns home and the retained row disappears.
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(screen.getByText('No agents detected')).toBeInTheDocument();
  });

  it('fits the borrowed host on resize and restores it through Open in workspace', () => {
    // Given: a registered terminal and an observable borrowed host.
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const terminal = register('p2');
    render(createElement(AgentsView));
    fireEvent.click(row('Codex'));
    // When: the host changes size and the explicit workspace action runs.
    act(() => {
      resized?.();
    });
    expect(terminal.fit).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));
    // Then: the same root is returned and the selected pane becomes active.
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(useWorkspaceStore.getState().workspaces[0]?.tabs[0]?.activePaneId).toBe('p2');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each(['p1', 'p2'])('retries when a competing borrow of %s is released', (borrowedPaneId) => {
    // Given: the registry's single borrow is held by another display host.
    const terminal = register('p1');
    if (borrowedPaneId !== 'p1') register(borrowedPaneId);
    const otherHost = document.createElement('div');
    const release = terminalHostRegistry.borrow(borrowedPaneId, otherHost);
    render(createElement(AgentsView));
    // When: this view selects a pane while another host has a borrow.
    fireEvent.click(row('Claude'));

    // Then: the first attempt is blocked without moving this pane's root.
    expect(screen.getByRole('status')).toHaveTextContent('Terminal is unavailable');
    expect(terminal.element.parentElement).toBe(
      borrowedPaneId === 'p1' ? otherHost : terminal.home,
    );

    // When: the competing borrower releases its terminal.
    act(() => {
      release?.();
    });

    // Then: release triggers a retry for both same-pane and different-pane conflicts.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(terminal.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    const fits = vi.mocked(terminal.fit).mock.calls.length;

    // When: the agent receives a routine runtime update.
    act(() => {
      usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': info('pty-1', 'claude') } });
    });

    // Then: it keeps the same borrow without fitting again.
    expect(terminal.fit).toHaveBeenCalledTimes(fits);

    // When: the user closes the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Close agent terminal' }));

    // Then: the root returns to its owner.
    expect(terminal.element.parentElement).toBe(terminal.home);
  });

  it.each(['pane', 'pty'] as const)(
    'returns the root when the selected %s disappears',
    (removed) => {
      // Given: a borrowed terminal whose owner is still mounted.
      const terminal = register('p1');
      render(createElement(AgentsView));
      fireEvent.click(row('Claude'));
      // When: the pane model or its PTY disappears.
      act(() => {
        useWorkspaceStore.setState({
          workspaces: [
            {
              ...workspace,
              panes: workspace.panes.flatMap((pane) => {
                if (pane.id !== 'p1') return [pane];
                return removed === 'pane' ? [] : [{ ...pane, ptyId: undefined }];
              }),
            },
          ],
        });
      });
      // Then: the selected panel is gone and its root has returned before owner disposal.
      expect(screen.queryByLabelText('Selected agent terminal')).not.toBeInTheDocument();
      expect(terminal.element.parentElement).toBe(terminal.home);
    },
  );

  it('contains a borrow failure and preserves the mounted workspace and navigation', () => {
    // Given: fitting the existing terminal always fails when it is borrowed.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const terminal = register('p1');
    vi.mocked(terminal.fit).mockImplementation(() => {
      throw new Error('Fit failed');
    });
    render(
      createElement(
        'div',
        null,
        createElement('div', { 'data-testid': 'workspace-owner' }),
        createElement(AgentsView),
      ),
    );

    // When: selection attempts to borrow the terminal.
    fireEvent.click(row('Claude'));

    // Then: failure is local to the panel and the original root is restored.
    expect(screen.getByRole('status')).toHaveTextContent('Terminal is unavailable');
    expect(screen.getByTestId('workspace-owner')).toBeInTheDocument();
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(terminalHostRegistry.getBorrowedHost()).toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to borrow terminal for pane p1',
      expect.any(Error),
    );

    // When: a routine runtime update arrives after the failed attempt.
    act(() => {
      usePaneInfoStore.setState({ infosByPtyId: { 'pty-1': info('pty-1', 'claude') } });
    });

    // Then: the same failed borrow is not repeatedly retried.
    expect(terminal.fit).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('Terminal is unavailable');

    // When: the user follows the fallback route to the workspace.
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace' }));

    // Then: workspace navigation succeeds without tearing down the root.
    expect(useUiStore.getState().activeView).toBe('workspace');
    expect(screen.getByTestId('workspace-owner')).toBeInTheDocument();
    expect(terminal.element.parentElement).toBe(terminal.home);
  });

  it('contains a release fit failure while revealing the workspace', () => {
    // Given: a borrowed terminal whose fit will fail when returned.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const terminal = register('p1');
    render(
      createElement(
        'div',
        null,
        createElement('div', { 'data-testid': 'workspace-owner' }),
        createElement(AgentsView),
      ),
    );
    fireEvent.click(row('Claude'));
    vi.mocked(terminal.fit).mockImplementationOnce(() => {
      throw new Error('Return fit failed');
    });

    // When: the view departs and its layout cleanup releases the root.
    act(() => {
      useUiStore.setState({
        activeView: 'workspace',
        launchPaletteOpen: false,
        pendingAgentSelectionPaneId: null,
      });
    });

    // Then: the workspace sibling remains mounted and the borrow is cleared.
    expect(screen.getByTestId('workspace-owner')).toBeInTheDocument();
    expect(terminal.element.parentElement).toBe(terminal.home);
    expect(terminalHostRegistry.getBorrowedHost()).toBeUndefined();
    expect(screen.queryByLabelText('Selected agent terminal')).not.toBeInTheDocument();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'Failed to return terminal for pane p1',
      expect.any(Error),
    );
  });
});
