import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { cloneDefaultSettings } from '../../../../../shared/settings-defaults';
import { MAX_AGENT_PRESET_STRING_LENGTH } from '../../../../../shared/agent-presets';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useWorkspaceStore } from '../../../stores/workspaceStore';
import { AgentPresetsSection } from './AgentPresetsSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

// Section tests use an isolated settings store while exercising its real debounce behavior.
vi.mock('../../../stores/settingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../stores/settingsStore')>();
  return { ...actual, useSettingsStore: actual.createSettingsStore() };
});

let fixture: SettingsApiFixture;
const originalWorkspaces = useWorkspaceStore.getState();
function setup(): void {
  const initial = cloneDefaultSettings();
  initial.projects.directories = ['/work/b', '/work/a'];
  fixture = createSettingsApiFixture({ initial });
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null });
}
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
}

describe('AgentPresetsSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup();
  });
  afterEach(() => {
    fixture.teardown();
    useWorkspaceStore.setState(originalWorkspaces);
    vi.useRealTimers();
  });

  it('adds scoped and shared presets without changing existing order', async () => {
    // Given: the defaults and registered project scope choices.
    render(<AgentPresetsSection />);
    expect(screen.getByRole('button', { name: 'Add preset' })).toBeDisabled();

    // When: a project-scoped command with an empty label is added.
    fireEvent.change(screen.getByRole('combobox', { name: 'Preset scope' }), {
      target: { value: '/work/a' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'New preset command' }), {
      target: { value: 'codex --add-dir /doc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    await flush();

    // Then: the scoped row is appended and persisted with a generated id.
    const presets = useSettingsStore.getState().settings!.agents.presets;
    expect(presets).toHaveLength(3);
    expect(presets[2]).toEqual({
      id: expect.any(String),
      label: '',
      command: 'codex --add-dir /doc',
      rootPath: '/work/a',
    });
    expect(screen.getByRole('textbox', { name: 'New preset command' })).toHaveValue('');
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ agents: { presets } }),
    );

    // When: another command is added for all projects.
    fireEvent.change(screen.getByRole('combobox', { name: 'Preset scope' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'New preset command' }), {
      target: { value: 'claude --verbose' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    await flush();

    // Then: shared scope is represented by an omitted rootPath.
    expect(useSettingsStore.getState().settings!.agents.presets[3]).not.toHaveProperty('rootPath');
  });

  it('shows known and orphan scopes after shared presets', () => {
    // Given: presets interleaved across registered and unregistered project roots.
    const settings = cloneDefaultSettings();
    settings.projects.directories = ['/work/b', '/work/a'];
    settings.agents.presets = [
      { id: 'lost', label: '', command: 'lost', rootPath: '/gone' },
      { id: 'a', label: '', command: 'a', rootPath: '/work/a' },
      { id: 'shared', label: '', command: 's' },
      { id: 'b', label: '', command: 'b', rootPath: '/work/b/' },
    ];
    useSettingsStore.setState({ settings });

    // When: the section renders.
    render(<AgentPresetsSection />);

    // Then: every preset is visible and group headings follow project order.
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['All projects', 'b', 'a', '/gone']);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('commits on blur and Enter, and cancels with Escape without persisting drafts', async () => {
    // Given: an editable default row.
    render(<AgentPresetsSection />);
    const input = screen.getByRole('textbox', { name: 'Command for Codex CLI' });

    // When: a draft is typed and canceled.
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await flush();

    // Then: Escape restores the saved command without queuing a write.
    expect(input).toHaveValue('codex');
    expect(fixture.api.update).not.toHaveBeenCalled();

    // When: a command is confirmed with Enter, followed by a label blur.
    fireEvent.change(input, { target: { value: 'codex --flag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const label = screen.getByRole('textbox', { name: 'Label for Codex CLI' });
    fireEvent.change(label, { target: { value: 'Custom Codex' } });
    fireEvent.blur(label);
    await flush();

    // Then: both edits survive the debounced round-trip.
    expect(useSettingsStore.getState().settings!.agents.presets[1]).toEqual({
      id: 'codex',
      label: 'Custom Codex',
      command: 'codex --flag',
    });
  });

  it('lets Escape reach the app only when the row has no draft', () => {
    // Given: an app-level listener standing in for the AppShell dismissal handler.
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    render(<AgentPresetsSection />);
    const input = screen.getByRole('textbox', { name: 'Command for Codex CLI' });

    try {
      // When: Escape is pressed with and then without a draft.
      fireEvent.change(input, { target: { value: 'draft' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      const callsWithDraft = onWindowKeyDown.mock.calls.length;
      fireEvent.keyDown(input, { key: 'Escape' });

      // Then: the first press only cancels the draft; the second one propagates.
      expect(callsWithDraft).toBe(0);
      expect(input).toHaveValue('codex');
      expect(onWindowKeyDown).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', onWindowKeyDown);
    }
  });

  it('names row controls by label or command instead of generated ids', async () => {
    // Given: the section with default rows.
    render(<AgentPresetsSection />);

    // When: an unlabeled preset is added with a generated id.
    fireEvent.change(screen.getByRole('textbox', { name: 'New preset command' }), {
      target: { value: 'aider' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add preset' }));
    await flush();

    // Then: the command stands in for the missing label.
    expect(screen.getByRole('textbox', { name: 'Label for aider' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Command for aider' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove aider' })).toBeInTheDocument();
  });

  it('keeps empty and overlong commands as invalid drafts and permits deletion', async () => {
    // Given: the command field of an existing preset.
    render(<AgentPresetsSection />);
    const input = screen.getByRole('textbox', { name: 'Command for Codex CLI' });

    // When: blank and overlong drafts are confirmed.
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);
    expect(screen.getByRole('alert')).toHaveTextContent('Command is required');
    fireEvent.change(input, { target: { value: 'x'.repeat(MAX_AGENT_PRESET_STRING_LENGTH + 1) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    // Then: validation never removes or changes the saved row.
    expect(fixture.api.update).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings!.agents.presets[1].command).toBe('codex');

    // When: the user removes the invalid draft's row.
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Codex CLI' }));
    await flush();

    // Then: removal remains possible even though the draft cannot be saved.
    expect(useSettingsStore.getState().settings!.agents.presets.map((preset) => preset.id)).toEqual(
      ['claude-code'],
    );
  });

  it('does not resurrect a valid row when blur precedes deletion', async () => {
    // Given: a changed command not yet confirmed.
    render(<AgentPresetsSection />);
    const input = screen.getByRole('textbox', { name: 'Command for Codex CLI' });
    fireEvent.change(input, { target: { value: 'codex --flag' } });

    // When: clicking remove first blurs and commits the input.
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Codex CLI' }));
    await flush();

    // Then: the latest array is used and the removed row stays removed.
    expect(
      screen.queryByRole('textbox', { name: 'Command for Codex CLI' }),
    ).not.toBeInTheDocument();
    expect(useSettingsStore.getState().settings!.agents.presets).toHaveLength(1);
  });

  it('ignores composition keys and preserves drafts across unrelated saves', async () => {
    // Given: a local command draft.
    render(<AgentPresetsSection />);
    const input = screen.getByRole('textbox', { name: 'Command for Codex CLI' });
    fireEvent.change(input, { target: { value: 'codex draft' } });

    // When: composition confirmation and cancel keys occur, then another row changes.
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    const other = screen.getByRole('textbox', { name: 'Label for Claude Code' });
    fireEvent.change(other, { target: { value: 'Other' } });
    fireEvent.blur(other);
    await flush();

    // Then: the unrelated authoritative response does not erase or commit this draft.
    expect(input).toHaveValue('codex draft');
    expect(useSettingsStore.getState().settings!.agents.presets[1].command).toBe('codex');
  });

  it('synchronizes an externally changed row and displays save errors', () => {
    // Given: an uncommitted local draft.
    render(<AgentPresetsSection />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Command for Codex CLI' }), {
      target: { value: 'local' },
    });

    // When: reloaded settings replace the saved command of this row.
    act(() => {
      const settings = cloneDefaultSettings();
      settings.agents.presets[1].command = 'external';
      useSettingsStore.setState({ settings, error: 'disk unavailable' });
    });

    // Then: the authoritative value replaces the stale draft and the error is visible.
    expect(screen.getByRole('textbox', { name: 'Command for Codex CLI' })).toHaveValue('external');
    expect(screen.getByRole('alert')).toHaveTextContent('disk unavailable');
  });

  it('offers durable closed projects by their saved names and excludes home', () => {
    // Given: a renamed closed project absent from registered directories, and a home workspace.
    const base = { tabs: [], panes: [], activeTabId: null, createdAt: 0, updatedAt: 0 };
    useWorkspaceStore.setState({
      workspaces: [
        { ...base, id: 'home', kind: 'home', name: 'Default', rootPath: '/home', isOpen: true },
        {
          ...base,
          id: 'closed',
          kind: 'project',
          name: 'Renamed',
          rootPath: '/closed',
          isOpen: false,
        },
      ],
    });

    // When: scope options are displayed.
    render(<AgentPresetsSection />);

    // Then: registered projects precede saved projects, and home is not a project scope.
    const options = within(screen.getByRole('combobox', { name: 'Preset scope' })).getAllByRole(
      'option',
    );
    expect(options.map((option) => option.textContent)).toEqual([
      'All projects',
      'b — /work/b',
      'a — /work/a',
      'Renamed — /closed',
    ]);
  });

  it('disables editing before settings load', () => {
    // Given: settings have not arrived from main.
    useSettingsStore.setState({ settings: null });

    // When: the section renders.
    render(<AgentPresetsSection />);

    // Then: fallback defaults cannot overwrite existing settings through the form.
    expect(screen.getByText('Loading agent presets…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add preset' })).toBeDisabled();
    expect(
      within(screen.getByRole('combobox', { name: 'Preset scope' })).getAllByRole('option'),
    ).toHaveLength(1);
  });
});
