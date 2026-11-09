import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { cloneDefaultSettings } from '../../../../shared/settings-defaults';
import type { Workspace } from '../../../../shared/types';
import type { LaunchTarget } from '../../agents/launchTarget';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { LaunchAgentPalette } from './LaunchAgentPalette';

const home: Workspace = {
  id: 'home',
  kind: 'home',
  isOpen: true,
  name: 'Default',
  rootPath: '/home',
  tabs: [],
  panes: [],
  activeTabId: null,
  createdAt: 0,
  updatedAt: 0,
};
const originalWorkspace = useWorkspaceStore.getState();
const originalSettings = useSettingsStore.getState();
const originalUi = useUiStore.getState();
const result = { workspaceId: 'project', tabId: 'new-tab', paneId: 'new-pane' };
const launchAgent = vi.fn(async () => result);
const selectWorkspacePane = vi.fn();

function projectStep(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Search projects' });
}
function presetStep(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Search presets' });
}
function enter(input: HTMLElement): void {
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('LaunchAgentPalette', () => {
  beforeEach(() => {
    launchAgent.mockReset().mockResolvedValue(result);
    selectWorkspacePane.mockClear();
    const settings = cloneDefaultSettings();
    settings.projects.directories = ['/work'];
    useSettingsStore.setState({ settings, isLoading: false, error: null });
    useWorkspaceStore.setState({
      workspaces: [
        home,
        { ...home, id: 'project', kind: 'project', name: 'Project', rootPath: '/work' },
      ],
      activeWorkspaceId: 'project',
      isLoading: false,
      error: null,
      launchAgent,
      selectWorkspacePane,
    });
    useUiStore.setState({
      ...originalUi,
      activeView: 'workspace',
      launchPaletteOpen: false,
      launchPaletteFocusRequest: 0,
      lastAgentPresetId: null,
      pendingAgentSelectionPaneId: null,
    });
    useUiStore.getState().openLaunchPalette();
  });
  afterEach(() => {
    useWorkspaceStore.setState(originalWorkspace);
    useSettingsStore.setState(originalSettings);
    useUiStore.setState(originalUi);
  });

  it('launches with Enter twice, selects the destination, and remembers the successful preset', async () => {
    // Given: the active project is the default and a previously used preset exists.
    useUiStore.setState({ lastAgentPresetId: 'codex' });
    render(
      <StrictMode>
        <LaunchAgentPalette />
      </StrictMode>,
    );
    expect(projectStep()).toHaveFocus();
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Project');
    // When: the defaults are accepted.
    enter(projectStep());
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Codex CLI');
    enter(presetStep());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Then: command launch and explicit navigation are separate operations.
    expect(launchAgent).toHaveBeenCalledExactlyOnceWith(
      { kind: 'project', rootPath: '/work' },
      expect.objectContaining({ id: 'codex', command: 'codex' }),
      expect.any(AbortSignal),
    );
    expect(selectWorkspacePane).toHaveBeenCalledExactlyOnceWith('project', 'new-tab', 'new-pane');
    expect(useUiStore.getState()).toMatchObject({
      activeView: 'workspace',
      lastAgentPresetId: 'codex',
      terminalFocusRequest: originalUi.terminalFocusRequest + 1,
    });
  });

  it('preserves first-step search and selection on Escape or the project chip', () => {
    // Given: a filtered project step and a selected home candidate.
    render(<LaunchAgentPalette />);
    fireEvent.change(projectStep(), { target: { value: '/home' } });
    enter(projectStep());
    // When: Escape returns to project selection.
    fireEvent.keyDown(presetStep(), { key: 'Escape' });
    // Then: the query and highlighted home are restored, and the dialog stays open.
    expect(projectStep()).toHaveValue('/home');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Default');
    enter(projectStep());
    fireEvent.click(screen.getByRole('button', { name: 'Change project' }));
    expect(projectStep()).toHaveValue('/home');
    expect(projectStep()).toHaveFocus();
    fireEvent.keyDown(projectStep(), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays in Agents and hands off pending selection without activating the workspace', async () => {
    // Given: the palette was opened from Agents.
    useUiStore.setState({ activeView: 'agents' });
    render(<LaunchAgentPalette />);
    // When: a launch succeeds.
    enter(projectStep());
    enter(presetStep());
    await waitFor(() => expect(useUiStore.getState().launchPaletteOpen).toBe(false));
    // Then: Agents will select after PTY readiness; workspace activation is untouched.
    expect(useUiStore.getState()).toMatchObject({
      activeView: 'agents',
      pendingAgentSelectionPaneId: 'new-pane',
    });
    expect(selectWorkspacePane).not.toHaveBeenCalled();
  });

  it('navigates from Settings to the launched terminal', async () => {
    // Given: Settings is the entry view.
    useUiStore.setState({ activeView: 'settings' });
    render(<LaunchAgentPalette />);
    // When: the user confirms a project and preset.
    enter(projectStep());
    enter(presetStep());
    // Then: success explicitly reveals the workspace and selects the new pane.
    await waitFor(() => expect(selectWorkspacePane).toHaveBeenCalled());
    expect(useUiStore.getState().activeView).toBe('workspace');
  });

  const cursorWorkspaceFields = {
    id: 'cursor-workspace',
    name: 'Cursor workspace',
    // Equivalent to home's root, so a project here must stay distinct from the home workspace.
    rootPath: '/home/./',
    panes: [{ id: 'cursor-pane', cwd: '/home' }],
  };
  const cursorWorkspaceCases: Array<{
    workspaces: Workspace[];
    activeWorkspaceId: string;
    expectedTarget: LaunchTarget;
  }> = [
    {
      workspaces: [
        home,
        { ...home, ...cursorWorkspaceFields, kind: 'project' },
        { ...home, id: 'active', kind: 'project', rootPath: '/active' },
      ],
      activeWorkspaceId: 'active',
      expectedTarget: { kind: 'project', rootPath: '/home/./' },
    },
    {
      workspaces: [
        { ...home, id: 'project', kind: 'project', name: 'Project', rootPath: '/work' },
        { ...home, ...cursorWorkspaceFields },
      ],
      activeWorkspaceId: 'project',
      expectedTarget: { kind: 'home' },
    },
  ];

  it.each(cursorWorkspaceCases)(
    'starts with presets for the cursor workspace ($expectedTarget.kind) and restores its project selection',
    async ({ workspaces, activeWorkspaceId, expectedTarget }) => {
      // Given: the cursor belongs to a workspace other than the active one.
      useWorkspaceStore.setState({ workspaces, activeWorkspaceId });
      useUiStore.setState({ activeView: 'agents', agentCursorPaneId: 'cursor-pane' });

      // When: the picker opens.
      render(<LaunchAgentPalette />);

      // Then: it starts at the presets for the cursor workspace.
      expect(presetStep()).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Change project' })).toHaveTextContent(
        'Cursor workspace',
      );

      // When: Escape returns to workspace selection.
      fireEvent.keyDown(presetStep(), { key: 'Escape' });

      // Then: the cursor workspace is selected without changing the actual active workspace.
      expect(projectStep()).toHaveFocus();
      expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Cursor workspace');
      expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Open');
      expect(screen.getByText('Active')).toBeInTheDocument();

      // When: the restored workspace and its default preset are confirmed.
      enter(projectStep());
      enter(presetStep());

      // Then: the agent launches in that workspace without navigating away.
      await waitFor(() => expect(launchAgent).toHaveBeenCalledTimes(1));
      expect(launchAgent).toHaveBeenCalledWith(
        expectedTarget,
        expect.any(Object),
        expect.any(AbortSignal),
      );
      expect(selectWorkspacePane).not.toHaveBeenCalled();
    },
  );

  it('resolves cursor presets after settings load without resetting the chosen workspace', () => {
    // Given: the cursor workspace is available before settings finish loading.
    const settings = cloneDefaultSettings();
    settings.agents.presets.push({
      id: 'scoped',
      label: 'Scoped command',
      command: 'agent',
      rootPath: '/work',
    });
    useSettingsStore.setState({ settings: null, isLoading: true });
    useWorkspaceStore.setState({
      workspaces: [
        home,
        {
          ...home,
          id: 'project',
          kind: 'project',
          rootPath: '/work',
          panes: [{ id: 'cursor-pane', cwd: '/work' }],
        },
      ],
    });
    useUiStore.setState({ activeView: 'agents', agentCursorPaneId: 'cursor-pane' });
    render(<LaunchAgentPalette />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading launch options');

    // When: settings arrive and the cursor changes while the picker is open.
    act(() => {
      useUiStore.getState().setAgentCursor(null);
      useSettingsStore.setState({ settings, isLoading: false });
    });

    // Then: preset selection uses the entry workspace and its scoped commands.
    expect(presetStep()).toHaveFocus();
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Scoped command');
  });

  it('returns to project selection when the chosen destination disappears', () => {
    // Given: preset selection started from a cursor workspace absent from registered projects.
    useWorkspaceStore.setState({
      workspaces: [
        ...useWorkspaceStore.getState().workspaces,
        {
          ...home,
          id: 'temporary',
          kind: 'project',
          rootPath: '/temporary',
          panes: [{ id: 'cursor-pane', cwd: '/temporary' }],
        },
      ],
    });
    useUiStore.setState({ activeView: 'agents', agentCursorPaneId: 'cursor-pane' });
    render(<LaunchAgentPalette />);
    expect(presetStep()).toHaveFocus();

    // When: the chosen workspace is removed while the picker remains open.
    act(() =>
      useWorkspaceStore.setState({
        workspaces: useWorkspaceStore
          .getState()
          .workspaces.filter((workspace) => workspace.id !== 'temporary'),
      }),
    );

    // Then: the picker offers workspace selection instead of retaining a stale launch target.
    expect(projectStep()).toHaveFocus();
    expect(launchAgent).not.toHaveBeenCalled();
  });

  it.each([null, 'missing-pane'])(
    'starts at project selection without a valid cursor (%s)',
    (cursor) => {
      // Given: Agents has no resolvable cursor workspace.
      useUiStore.setState({ activeView: 'agents', agentCursorPaneId: cursor });

      // When: the picker opens.
      render(<LaunchAgentPalette />);

      // Then: the existing two-step flow defaults to the active workspace.
      expect(projectStep()).toHaveFocus();
      expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Project');
    },
  );

  it('distinguishes no presets from no search matches and links to the settings section', () => {
    // Given: only a preset scoped to another project.
    const settings = cloneDefaultSettings();
    settings.agents.presets = [
      { id: 'other', label: 'Other', command: 'agent', rootPath: '/other' },
    ];
    useSettingsStore.setState({ settings });
    render(<LaunchAgentPalette />);
    // When: the active project is selected.
    enter(projectStep());
    // Then: the palette offers settings without launching anything.
    expect(screen.getByText('No presets available')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Agent presets settings' }));
    expect(useUiStore.getState()).toMatchObject({
      activeView: 'settings',
      settingsSection: 'agentPresets',
      launchPaletteOpen: false,
    });
    expect(launchAgent).not.toHaveBeenCalled();
  });

  it('filters scoped commands and falls back when the remembered preset is removed', () => {
    // Given: a scoped command before the shared defaults, and an obsolete remembered ID.
    const settings = cloneDefaultSettings();
    settings.agents.presets.push({
      id: 'scoped',
      label: 'With docs',
      command: 'codex --add-dir /docs',
      rootPath: '/work',
    });
    useSettingsStore.setState({ settings });
    useUiStore.setState({ lastAgentPresetId: 'deleted' });
    render(<LaunchAgentPalette />);
    // When: presets are displayed and searched by command.
    enter(projectStep());
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('With docs');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Project preset');
    fireEvent.change(presetStep(), { target: { value: '--ADD-DIR' } });
    // Then: command search is case insensitive, and unmatched queries retain the input.
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(presetStep(), { target: { value: 'unmatched' } });
    expect(screen.getByText('No presets match')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open Agent presets settings' }),
    ).not.toBeInTheDocument();
  });

  it('keeps launch errors visible and allows retry without duplicate same-tick submission', async () => {
    // Given: the first attempt fails at the tab limit.
    launchAgent.mockRejectedValueOnce(new Error('Workspace tab limit reached'));
    render(<LaunchAgentPalette />);
    enter(projectStep());
    // When: Enter is pressed twice before React can update busy state.
    act(() => {
      enter(presetStep());
      enter(presetStep());
    });
    // Then: the session submits once and remains open on failure.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('tab limit reached'));
    expect(launchAgent).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().lastAgentPresetId).toBeNull();
    // When: the same preset is retried successfully.
    enter(presetStep());
    // Then: success closes the palette.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(launchAgent).toHaveBeenCalledTimes(2);
  });

  it.each(['dismiss', 'navigate'] as const)('ignores late success after %s', async (action) => {
    // Given: launch remains pending after submission.
    let resolve!: (value: typeof result) => void;
    launchAgent.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<LaunchAgentPalette />);
    enter(projectStep());
    enter(presetStep());
    const signal = vi.mocked(useWorkspaceStore.getState().launchAgent).mock.calls[0][2]!;
    // When: the user leaves the session before its response arrives.
    if (action === 'dismiss') fireEvent.keyDown(presetStep(), { key: 'Escape' });
    else act(() => useUiStore.getState().openSettings());
    await act(async () => {
      resolve(result);
    });
    // Then: the completed work cannot steal navigation or set stale pending selection.
    expect(signal.aborted).toBe(true);
    expect(selectWorkspacePane).not.toHaveBeenCalled();
    expect(useUiStore.getState().pendingAgentSelectionPaneId).toBeNull();
    expect(useUiStore.getState().lastAgentPresetId).toBeNull();
    expect(useUiStore.getState().activeView).toBe(action === 'navigate' ? 'settings' : 'workspace');
  });

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'leaves composition keys to the IME and traps Tab within the second step (%j)',
    (composition) => {
      // Given: preset selection with a project chip and search field.
      render(<LaunchAgentPalette />);
      enter(projectStep());
      // When: IME confirmation/cancellation keys arrive.
      fireEvent.keyDown(presetStep(), { key: 'Enter', ...composition });
      fireEvent.keyDown(presetStep(), { key: 'Escape', ...composition });
      // Then: the step and command remain unchanged; Tab moves to the chip.
      expect(presetStep()).toBeInTheDocument();
      expect(launchAgent).not.toHaveBeenCalled();
      fireEvent.keyDown(presetStep(), { key: 'Tab' });
      expect(screen.getByRole('button', { name: 'Change project' })).toHaveFocus();
    },
  );
});
