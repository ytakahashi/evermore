import { describe, expect, it } from 'vite-plus/test';
import type { PaneLayout, PaneRuntimeInfo, Workspace } from '../../../../shared/types';
import { collectAgentSessions, formatAgentCwdLabel, groupAgentSessions } from './agent-sessions';

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
    kind: 'project',
    isOpen: true,
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
  it('disambiguates against open workspaces without agent sessions', () => {
    // Given: only one of two same-named workspaces has an agent.
    const entries = [
      workspace({
        id: 'a',
        name: 'api',
        rootPath: '/foo/api',
        tabs: [
          {
            id: 't',
            name: 'shell',
            isCustomName: false,
            layout: { type: 'leaf', paneId: 'p' },
            activePaneId: 'p',
          },
        ],
        panes: [{ id: 'p', cwd: '/foo/api', ptyId: 'pty' }],
      }),
      workspace({ id: 'b', name: 'api', rootPath: '/bar/api' }),
    ];
    // When: sessions are collected before and after the empty peer closes.
    const before = collectAgentSessions(entries, { pty: agentInfo('pty') });
    const after = collectAgentSessions([entries[0], { ...entries[1], isOpen: false }], {
      pty: agentInfo('pty'),
    });
    // Then: the labels use all open workspaces rather than only visible cards.
    expect(before.map((session) => session.workspaceName)).toEqual(['api — foo']);
    expect(after.map((session) => session.workspaceName)).toEqual(['api']);
  });

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
        ptyId: 'pty-1',
        workspaceId: 'ws-1',
        workspaceName: 'Project',
        workspaceKind: 'project',
        workspaceRootPath: '/tmp',
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
  it('retains the selected pane in structural order without agent or runtime info', () => {
    // Given: a selected shell between agent panes, plus a pane without a PTY.
    const workspaces = [
      workspace({
        id: 'ws',
        name: 'Project',
        tabs: [
          {
            id: 'tab',
            name: 'shell',
            isCustomName: false,
            activePaneId: 'p1',
            layout: splitLayout('p1', 'p2'),
          },
        ],
        panes: [
          { id: 'p1', cwd: '/a', ptyId: 'pty-1' },
          { id: 'p2', cwd: '/b', ptyId: 'pty-2' },
        ],
      }),
    ];
    // When: runtime info has disappeared for the selected pane.
    const sessions = collectAgentSessions(
      workspaces,
      { 'pty-2': agentInfo('pty-2') },
      { retainPaneId: 'p1' },
    );
    // Then: it stays first without inventing runtime information.
    expect(sessions.map((session) => session.paneId)).toEqual(['p1', 'p2']);
    expect(sessions[0]?.info).toBeUndefined();
    expect(
      collectAgentSessions(workspaces, { 'pty-1': runtimeInfo('pty-1') }, { retainPaneId: 'p1' }),
    ).toHaveLength(1);
    const withoutPty = workspaces.map((ws) => ({
      ...ws,
      panes: ws.panes.map((pane) => ({ ...pane, ptyId: undefined })),
    }));
    expect(collectAgentSessions(withoutPty, {}, { retainPaneId: 'p1' })).toEqual([]);
  });
});

it('excludes closed workspaces even when stale PTY information or selection remains', () => {
  // Given: a closed workspace whose runtime cleanup has not reached the mirror yet.
  const closed = workspace({
    id: 'closed',
    name: 'Closed',
    isOpen: false,
    tabs: [
      {
        id: 'tab',
        name: 'Agent',
        isCustomName: false,
        layout: { type: 'leaf', paneId: 'pane' },
        activePaneId: 'pane',
      },
    ],
    panes: [{ id: 'pane', cwd: '/tmp', ptyId: 'pty' }],
  });
  // When: cards are collected while a preview still references the retired pane.
  const sessions = collectAgentSessions(
    [closed],
    { pty: agentInfo('pty') },
    { retainPaneId: 'pane' },
  );
  // Then: no card or retained selection resurrects the closed session.
  expect(sessions).toEqual([]);
});

function agentWorkspace(
  id: string,
  paneIds: readonly string[],
  overrides: Partial<Workspace> = {},
): Workspace {
  return workspace({
    id,
    name: id,
    tabs: [
      {
        id: `${id}-tab`,
        name: 'shell',
        isCustomName: false,
        layout:
          paneIds.length === 2
            ? splitLayout(paneIds[0], paneIds[1])
            : { type: 'leaf', paneId: paneIds[0] },
        activePaneId: paneIds[0],
      },
    ],
    panes: paneIds.map((paneId) => ({ id: paneId, cwd: '/tmp', ptyId: `pty-${paneId}` })),
    ...overrides,
  });
}

it('places home sessions after every project session', () => {
  // Given: home stored first, followed by two projects with agents.
  const workspaces = [
    agentWorkspace('home', ['h1'], { kind: 'home', rootPath: '/Users/tester' }),
    agentWorkspace('a', ['a1', 'a2'], { rootPath: '/work/a' }),
    agentWorkspace('b', ['b1']),
  ];
  const infos = Object.fromEntries(
    ['h1', 'a1', 'a2', 'b1'].map((paneId) => [`pty-${paneId}`, agentInfo(`pty-${paneId}`)]),
  );

  // When: the sessions are collected.
  const sessions = collectAgentSessions(workspaces, infos);

  // Then: projects keep storage order and carry their workspace context, with home last.
  expect(sessions.map((session) => session.paneId)).toEqual(['a1', 'a2', 'b1', 'h1']);
  expect(sessions[0]).toMatchObject({ workspaceKind: 'project', workspaceRootPath: '/work/a' });
  expect(sessions[3]).toMatchObject({ workspaceKind: 'home', workspaceRootPath: '/Users/tester' });
});

describe('groupAgentSessions', () => {
  it('groups consecutive sessions by workspace in flat order', () => {
    // Given: sessions from two projects and home, with an agentless project in between.
    const workspaces = [
      agentWorkspace('home', ['h1'], { kind: 'home', name: 'Default' }),
      agentWorkspace('a', ['a1', 'a2']),
      agentWorkspace('idle', ['i1']),
      agentWorkspace('b', ['b1']),
    ];
    const infos = Object.fromEntries(
      ['h1', 'a1', 'a2', 'b1'].map((paneId) => [`pty-${paneId}`, agentInfo(`pty-${paneId}`)]),
    );
    const sessions = collectAgentSessions(workspaces, infos);

    // When: the sessions are grouped.
    const groups = groupAgentSessions(sessions);

    // Then: each group keeps its sessions in order, and the agentless workspace has no group.
    expect(
      groups.map((group) => [group.workspaceId, group.sessions.map(({ paneId }) => paneId)]),
    ).toEqual([
      ['a', ['a1', 'a2']],
      ['b', ['b1']],
      ['home', ['h1']],
    ]);
    expect(groups.flatMap((group) => group.sessions)).toEqual(sessions);
    expect(groups[2]).toMatchObject({ workspaceName: 'Default', workspaceRootPath: '/tmp' });
  });

  it('returns no groups without sessions', () => {
    // Given / When / Then: an empty list yields no headings.
    expect(groupAgentSessions([])).toEqual([]);
  });
});

describe('formatAgentCwdLabel', () => {
  const home = '/Users/tester';
  const root = '/Users/tester/ghq/evermore';

  it('omits the project root and shows paths inside it relative to the root', () => {
    // Given: panes at and below a project root, including a trailing slash on either side.

    // When / Then: the root itself is omitted and descendants are relative.
    expect(formatAgentCwdLabel(root, 'project', root, home)).toBeNull();
    expect(formatAgentCwdLabel(`${root}/`, 'project', root, home)).toBeNull();
    expect(formatAgentCwdLabel(`${root}/src/main`, 'project', `${root}/`, home)).toBe('src/main');
  });

  it('shows paths outside the project as home-shortened absolute paths', () => {
    // Given: a pane that left the project, including a sibling sharing the root as a text prefix.

    // When / Then: segment boundaries decide containment.
    expect(formatAgentCwdLabel('/Users/tester/ghq', 'project', root, home)).toBe('~/ghq');
    expect(formatAgentCwdLabel(`${root}-v2/src`, 'project', root, home)).toBe(
      '~/ghq/evermore-v2/src',
    );
    expect(formatAgentCwdLabel('/opt/tools', 'project', root, home)).toBe('/opt/tools');
  });

  it('shows home paths as home-shortened absolute paths, including the root', () => {
    // Given: panes in the home workspace.

    // When / Then: the home root is shown rather than omitted.
    expect(formatAgentCwdLabel(home, 'home', home, home)).toBe('~');
    expect(formatAgentCwdLabel(`${home}/Downloads`, 'home', home, home)).toBe('~/Downloads');
  });

  it('keeps absolute paths when the home directory is unknown', () => {
    // Given: no home workspace has been loaded.

    // When / Then: paths are shown without shortening.
    expect(formatAgentCwdLabel('/Users/tester/ghq', 'project', root, undefined)).toBe(
      '/Users/tester/ghq',
    );
  });
});
