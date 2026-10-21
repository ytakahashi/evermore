import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import type { AppSettings } from '../../../../../shared/types';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ProjectsSection } from './ProjectsSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

function settingsWithDirectories(directories: string[]): AppSettings {
  return { ...DEFAULT_APP_SETTINGS, projects: { directories } };
}

describe('ProjectsSection', () => {
  let fixture: SettingsApiFixture | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture?.teardown();
    fixture = undefined;
  });

  it('shows an empty state when no directories are registered', () => {
    // Given: built-in defaults with no registered directories.
    fixture = createSettingsApiFixture();

    // When: the section renders.
    render(<ProjectsSection />);

    // Then: the empty state is shown instead of a list.
    expect(screen.getByText('No project directories registered yet.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Project directories' })).not.toBeInTheDocument();
  });

  it('lists the registered directories in their persisted order', () => {
    // Given: two registered directories.
    fixture = createSettingsApiFixture({
      initial: settingsWithDirectories(['/work/b', '/work/a']),
    });

    // When: the section renders.
    render(<ProjectsSection />);

    // Then: entries keep the registration order instead of being sorted.
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(['/work/b', '/work/a']);
  });

  it('appends a directory chosen in the native picker', async () => {
    // Given: one registered directory and a picker that selects another.
    const pickDirectory = vi.fn(() => Promise.resolve('/work/new'));
    fixture = createSettingsApiFixture({
      initial: settingsWithDirectories(['/work/existing']),
      windowApi: { pickDirectory },
    });
    render(<ProjectsSection />);

    // When: the user adds a directory.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add directory…' }));
      await Promise.resolve();
    });

    // Then: the selection is appended and persisted after the debounce.
    expect(useSettingsStore.getState().settings?.projects.directories).toEqual([
      '/work/existing',
      '/work/new',
    ]);
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ projects: { directories: ['/work/existing', '/work/new'] } }),
    );
  });

  it.each([
    ['the picker is cancelled', null],
    ['the directory is already registered', '/work/existing'],
  ])('leaves the list unchanged when %s', async (_label, picked) => {
    // Given: one registered directory and a picker returning the case's result.
    const pickDirectory = vi.fn(() => Promise.resolve(picked));
    fixture = createSettingsApiFixture({
      initial: settingsWithDirectories(['/work/existing']),
      windowApi: { pickDirectory },
    });
    render(<ProjectsSection />);

    // When: the user tries to add a directory.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add directory…' }));
      await Promise.resolve();
    });

    // Then: no update is queued.
    await vi.advanceTimersByTimeAsync(350);
    expect(pickDirectory).toHaveBeenCalledTimes(1);
    expect(fixture.api.update).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings?.projects.directories).toEqual(['/work/existing']);
  });

  it('shows the picker failure without changing the list', async () => {
    // Given: a picker whose IPC call rejects.
    const pickDirectory = vi.fn(() => Promise.reject(new Error('dialog unavailable')));
    fixture = createSettingsApiFixture({ windowApi: { pickDirectory } });
    render(<ProjectsSection />);

    // When: the user tries to add a directory.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add directory…' }));
      await Promise.resolve();
    });

    // Then: the error is surfaced and nothing is persisted.
    expect(screen.getByText('Failed to open picker: dialog unavailable')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).not.toHaveBeenCalled();
  });

  it('removes a directory from the list', async () => {
    // Given: two registered directories.
    fixture = createSettingsApiFixture({
      initial: settingsWithDirectories(['/work/a', '/work/b']),
    });
    render(<ProjectsSection />);

    // When: the user removes the first one.
    fireEvent.click(screen.getByRole('button', { name: 'Remove /work/a' }));

    // Then: only the other directory remains and the full list is persisted.
    expect(useSettingsStore.getState().settings?.projects.directories).toEqual(['/work/b']);
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ projects: { directories: ['/work/b'] } }),
    );
  });
});
