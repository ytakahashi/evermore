import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecommendedSetupSection } from './RecommendedSetupSection';

describe('RecommendedSetupSection', () => {
  let clipboardWriteText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    clipboardWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('renders local setup snippets without loading persisted settings', () => {
    // Given: the recommended setup section is visible.
    render(<RecommendedSetupSection />);

    // Then: the optional setup snippets and their target files are shown for manual copy/paste.
    expect(screen.getByRole('heading', { name: 'Recommended setup' })).toBeInTheDocument();
    expect(screen.getByText('OSC 7 cwd tracking')).toBeInTheDocument();
    expect(screen.getByText('SSH tunnel reliability')).toBeInTheDocument();
    expect(screen.getByText('~/.zshrc')).toBeInTheDocument();
    expect(screen.getByText('~/.ssh/config')).toBeInTheDocument();
  });

  it('copies the selected snippet to the clipboard', async () => {
    // Given: the recommended setup section is visible.
    render(<RecommendedSetupSection />);

    // When: the user copies the SSH config snippet.
    fireEvent.click(screen.getByTitle('Copy SSH tunnel reliability'));
    await act(async () => {
      await Promise.resolve();
    });

    // Then: only that snippet content is written to the clipboard and a success state is shown.
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('ExitOnForwardFailure'),
    );
    expect(clipboardWriteText).not.toHaveBeenCalledWith(expect.stringContaining('add-zsh-hook'));
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows an inline error when clipboard access is unavailable', () => {
    // Given: the browser environment does not expose clipboard access.
    Reflect.deleteProperty(navigator, 'clipboard');
    render(<RecommendedSetupSection />);

    // When: the user tries to copy a snippet.
    fireEvent.click(screen.getByTitle('Copy OSC 7 cwd tracking'));

    // Then: the copy failure is surfaced without persisting any setting.
    expect(screen.getByText('Copy failed')).toBeInTheDocument();
  });
});
