import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutSection } from './AboutSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('AboutSection', () => {
  let fixture: SettingsApiFixture;
  let clipboardWriteText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  beforeEach(() => {
    fixture = createSettingsApiFixture();
    clipboardWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    fixture.teardown();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('renders the persisted settings file path after the api resolves', async () => {
    // Given: the section is rendered with the fixture's default `getFilePath`.

    // When: the section mounts.
    render(<AboutSection />);

    // Then: the loading state is shown first and the resolved path replaces it once the
    // useEffect promise settles.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('/tmp/evermore/settings.json')).toBeInTheDocument();
  });

  it('surfaces an error message when the api fails to return the file path', async () => {
    // Given: the fixture's api rejects `getFilePath` (e.g. main-process IPC error).
    vi.mocked(fixture.api.getFilePath).mockRejectedValueOnce(new Error('disk on fire'));

    // When: the section mounts.
    render(<AboutSection />);

    // Then: the error is shown inline instead of the path.
    expect(await screen.findByText(/Failed to load: disk on fire/i)).toBeInTheDocument();
    // And: the action buttons remain disabled because there is no path to act on.
    expect(screen.getByRole('button', { name: 'Copy path' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Open in Finder' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload from disk' })).toBeDisabled();
  });

  it('opens the settings file via the main process when Open in Finder is clicked', async () => {
    // Given: the file path has loaded so the buttons are enabled.
    render(<AboutSection />);
    await screen.findByText('/tmp/evermore/settings.json');

    // When: the user clicks Open in Finder.
    fireEvent.click(screen.getByRole('button', { name: 'Open in Finder' }));

    // Then: the api `openFile` channel is invoked. The renderer never opens files directly —
    // this is the load-bearing IPC hop that asks main to call `shell.showItemInFolder`.
    await waitFor(() => {
      expect(fixture.api.openFile).toHaveBeenCalledTimes(1);
    });
  });

  it('reloads settings from disk and flashes a Reloaded badge on success', async () => {
    // Given: the file path has loaded.
    render(<AboutSection />);
    await screen.findByText('/tmp/evermore/settings.json');

    // When: the user clicks Reload from disk.
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }));

    // Then: the api `reload` channel is invoked and the transient confirmation badge appears.
    await waitFor(() => {
      expect(fixture.api.reload).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Reloaded')).toBeInTheDocument();
  });

  it('copies the resolved path to the clipboard and shows a Copied confirmation', async () => {
    // Given: the file path has loaded and the test owns navigator.clipboard.
    render(<AboutSection />);
    await screen.findByText('/tmp/evermore/settings.json');

    // When: the user clicks Copy path.
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }));

    // Then: the path is written to the clipboard verbatim and the badge confirms it.
    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith('/tmp/evermore/settings.json');
    });
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});
