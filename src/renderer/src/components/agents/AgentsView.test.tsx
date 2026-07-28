import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRuntimeInfo, Workspace } from '../../../../shared/types';
import { usePaneInfoStore } from '../../stores/paneInfoStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { AgentsView } from './AgentsView';

const workspace1: Workspace = {
  id: 'workspace-1',
  name: 'Default',
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
  panes: [{ id: 'workspace-2-pane-1', cwd: '/Users/tester/project/server', ptyId: 'pty-2' }],
  activeTabId: 'workspace-2-tab-1',
  createdAt: 1,
  updatedAt: 1,
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
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        workspace: {
          update: vi.fn(() => Promise.resolve()),
          setActiveWorkspaceId: vi.fn(() => Promise.resolve()),
        },
      },
    });
    useWorkspaceStore.setState({
      workspaces: [workspace1, workspace2],
      activeWorkspaceId: workspace1.id,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({ activeView: 'agents' });
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      isLoading: false,
      error: null,
    });
    usePaneInfoStore.setState({ infosByPtyId: {}, isLoading: false, error: null });
    useUiStore.setState({ activeView: 'workspace' });
    Reflect.deleteProperty(window, 'api');
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
    expect(screen.getByText('Default / zsh')).toBeInTheDocument();
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

  it('activates the pane and returns to the workspace view when a card is clicked', () => {
    // Given: an agent running in a workspace other than the active one.
    usePaneInfoStore.setState({
      infosByPtyId: { 'pty-2': agentInfo('pty-2') },
      isLoading: false,
      error: null,
    });
    render(<AgentsView />);

    // When: the card is clicked.
    fireEvent.click(screen.getByText('Project / server'));

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
});
