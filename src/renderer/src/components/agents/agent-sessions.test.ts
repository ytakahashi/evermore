import { describe, expect, it } from 'vitest';
import type { PaneLayout, PaneRuntimeInfo, Workspace } from '../../../../shared/types';
import { collectAgentSessions } from './agent-sessions';

function runtimeInfo(ptyId: string, overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return {
    ptyId,
    processActivity: 'running',
    foregroundSession: { kind: 'other' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    observedAt: 1000,
    ...overrides,
  };
}

function agentInfo(ptyId: string, overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  return runtimeInfo(ptyId, {
    agent: {
      known: 'claude',
      kind: 'claude',
      status: 'running',
      source: 'agent-protocol',
      observedAt: 1000,
    },
    ...overrides,
  });
}

function splitLayout(leftPaneId: string, rightPaneId: string): PaneLayout {
  return {
    type: 'split',
    direction: 'horizontal',
    ratio: 0.5,
    children: [
      { type: 'leaf', paneId: leftPaneId },
      { type: 'leaf', paneId: rightPaneId },
    ],
  };
}

function workspace(overrides: Partial<Workspace> & Pick<Workspace, 'id' | 'name'>): Workspace {
  return {
    rootPath: '/tmp',
    tabs: [],
    panes: [],
    activeTabId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('collectAgentSessions', () => {
  it('collects only panes that have an agent, with their workspace and tab labels', () => {
    // Given: one workspace whose tab holds an agent pane and a plain shell pane.
    const workspaces = [
      workspace({
        id: 'ws-1',
        name: 'Project',
        tabs: [
          {
            id: 'tab-1',
            name: 'server',
            isCustomName: false,
            layout: splitLayout('p1', 'p2'),
            activePaneId: 'p1',
          },
        ],
        panes: [
          { id: 'p1', cwd: '/Users/tester/project', ptyId: 'pty-1' },
          { id: 'p2', cwd: '/Users/tester/logs', ptyId: 'pty-2' },
        ],
      }),
    ];
    const infos = {
      'pty-1': agentInfo('pty-1', { userPrompt: 'Fix the failing tests' }),
      'pty-2': runtimeInfo('pty-2'),
    };

    // When: the sessions are collected.
    const sessions = collectAgentSessions(workspaces, infos);

    // Then: the non-agent pane is skipped and the agent pane carries everything a card needs.
    expect(sessions).toEqual([
      {
        paneId: 'p1',
        workspaceId: 'ws-1',
        workspaceName: 'Project',
        tabId: 'tab-1',
        tabName: 'server',
        info: infos['pty-1'],
        cwd: '/Users/tester/project',
      },
    ]);
  });

  it('orders sessions by workspace, then tab, then pane position', () => {
    // Given: agent panes spread across two workspaces, several tabs, and both halves of a split.
    const workspaces = [
      workspace({
        id: 'ws-1',
        name: 'First',
        tabs: [
          {
            id: 'tab-a',
            name: 'a',
            isCustomName: false,
            layout: splitLayout('p1', 'p2'),
            activePaneId: 'p1',
          },
          {
            id: 'tab-b',
            name: 'b',
            isCustomName: false,
            layout: { type: 'leaf', paneId: 'p3' },
            activePaneId: 'p3',
          },
        ],
        panes: [
          { id: 'p1', cwd: '/a', ptyId: 'pty-1' },
          { id: 'p2', cwd: '/b', ptyId: 'pty-2' },
          { id: 'p3', cwd: '/c', ptyId: 'pty-3' },
        ],
      }),
      workspace({
        id: 'ws-2',
        name: 'Second',
        tabs: [
          {
            id: 'tab-c',
            name: 'c',
            isCustomName: false,
            layout: { type: 'leaf', paneId: 'p4' },
            activePaneId: 'p4',
          },
        ],
        panes: [{ id: 'p4', cwd: '/d', ptyId: 'pty-4' }],
      }),
    ];
    const infos = {
      'pty-1': agentInfo('pty-1'),
      'pty-2': agentInfo('pty-2'),
      'pty-3': agentInfo('pty-3'),
      'pty-4': agentInfo('pty-4'),
    };

    // When: the sessions are collected.
    const sessions = collectAgentSessions(workspaces, infos);

    // Then: the order matches the sidebar's structural order, so cards never reorder themselves
    // while the user is reading them.
    expect(sessions.map((session) => session.paneId)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('skips panes with no ptyId and panes with no runtime info', () => {
    // Given: a tab holding a pane that has not started a shell and one whose info has not arrived.
    const workspaces = [
      workspace({
        id: 'ws-1',
        name: 'Project',
        tabs: [
          {
            id: 'tab-1',
            name: 'server',
            isCustomName: false,
            layout: splitLayout('p1', 'p2'),
            activePaneId: 'p1',
          },
        ],
        panes: [
          { id: 'p1', cwd: '/a' },
          { id: 'p2', cwd: '/b', ptyId: 'pty-2' },
        ],
      }),
    ];

    // When: the sessions are collected with no matching runtime info.
    const sessions = collectAgentSessions(workspaces, {});

    // Then: neither pane can be classified, so neither appears.
    expect(sessions).toEqual([]);
  });

  it('skips a layout entry whose pane is missing from the workspace', () => {
    // Given: a layout referencing a pane id that the panes array no longer holds, which can happen
    // transiently while a structural edit is in flight.
    const workspaces = [
      workspace({
        id: 'ws-1',
        name: 'Project',
        tabs: [
          {
            id: 'tab-1',
            name: 'server',
            isCustomName: false,
            layout: splitLayout('missing', 'p2'),
            activePaneId: 'p2',
          },
        ],
        panes: [{ id: 'p2', cwd: '/b', ptyId: 'pty-2' }],
      }),
    ];

    // When: the sessions are collected.
    const sessions = collectAgentSessions(workspaces, { 'pty-2': agentInfo('pty-2') });

    // Then: the dangling id is passed over rather than throwing, and the valid pane still appears.
    expect(sessions.map((session) => session.paneId)).toEqual(['p2']);
  });
});
