import { createElement, StrictMode } from 'react';
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
  const handle = { home, element, fit: vi.fn() };
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
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: 'ws',
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-1': info('pty-1', 'claude'), 'pty-2': info('pty-2', 'codex') },
    });
    useUiStore.setState({ activeView: 'agents' });
  });
  afterEach(() => {
    cleanup();
    for (const dispose of cleanups.splice(0)) dispose();
    useUiStore.setState({ activeView: 'workspace' });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the first root before borrowing another and preserves focus until terminal click', () => {
    // Given: two existing xterm roots and StrictMode lifecycle replay.
    const first = register('p1');
    const second = register('p2');
    render(createElement(StrictMode, null, createElement(AgentsView)));
    row('Claude').focus();
    // When: selection switches between sessions, then is toggled off.
    fireEvent.click(row('Claude'));
    expect(first.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    expect(row('Claude')).toHaveFocus();
    fireEvent.click(row('Codex'));
    expect(first.element.parentElement).toBe(first.home);
    expect(second.element.closest('[aria-label="Selected agent terminal"]')).not.toBeNull();
    fireEvent.click(row('Codex'));
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
    fireEvent.click(screen.getByRole('button', { name: /No agent running/ }));
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
      useUiStore.setState({ activeView: 'workspace' });
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
