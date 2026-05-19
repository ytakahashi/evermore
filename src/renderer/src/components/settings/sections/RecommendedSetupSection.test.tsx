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
    expect(screen.getByText('Shell integration (zsh)')).toBeInTheDocument();
    expect(screen.getByText('SSH tunnel reliability')).toBeInTheDocument();
    expect(screen.getByText('~/.zshrc')).toBeInTheDocument();
    expect(screen.getByText('~/.ssh/config')).toBeInTheDocument();
    // The previous OSC 7-only entry has been folded into the combined snippet above.
    expect(screen.queryByText('OSC 7 cwd tracking')).not.toBeInTheDocument();
  });

  it('lists SSH tunnel reliability before the zsh shell integration snippet', () => {
    // Given: the recommended setup section is visible. The order matters because the zsh snippet
    // is ~100 lines long; surfacing the shorter, more impactful SSH snippet first keeps it
    // discoverable now that the zsh snippet is largely auto-handled by Step 2.
    render(<RecommendedSetupSection />);

    // When: the snippet titles are read in document order.
    const titles = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);

    // Then: SSH tunnel reliability appears before Shell integration (zsh).
    const sshIndex = titles.findIndex((title) => title === 'SSH tunnel reliability');
    const zshIndex = titles.findIndex((title) => title === 'Shell integration (zsh)');
    expect(sshIndex).toBeGreaterThanOrEqual(0);
    expect(zshIndex).toBeGreaterThan(sshIndex);
  });

  it('clarifies that manual paste is only a fallback when auto-inject is enabled', () => {
    // Given: the recommended setup section is visible.
    render(<RecommendedSetupSection />);

    // Then: the zsh snippet description tells the user that the manual snippet is optional under
    // the default Advanced features configuration, and explains the subshell carve-out so users
    // who want lifecycle markers inside `zsh`-from-zsh subshells still know to paste it.
    expect(
      screen.getByText(/Automatic shell integration \(zsh\) enabled \(the default\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/subshells started inside an Evermore PTY/i)).toBeInTheDocument();
  });

  it('copies the selected snippet to the clipboard', async () => {
    // Given: the recommended setup section is visible.
    render(<RecommendedSetupSection />);

    // When: the user copies the SSH config snippet.
    fireEvent.click(screen.getByRole('button', { name: 'Copy SSH tunnel reliability snippet' }));
    await act(async () => {
      await Promise.resolve();
    });

    // Then: only that snippet content is written to the clipboard and a success state is shown.
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('ExitOnForwardFailure'),
    );
    // The shell integration snippet uses a distinctive installer-function name that the SSH snippet
    // does not contain, so this guards against the two snippets being copied together.
    expect(clipboardWriteText).not.toHaveBeenCalledWith(
      expect.stringContaining('_evermore_install_shell_integration'),
    );
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('copies the shell integration snippet with the OSC 633;E and OSC 133 markers intact', async () => {
    // Given: the recommended setup section is visible.
    render(<RecommendedSetupSection />);

    // When: the user copies the shell integration snippet.
    fireEvent.click(screen.getByRole('button', { name: 'Copy Shell integration (zsh) snippet' }));
    await act(async () => {
      await Promise.resolve();
    });

    // Then: the clipboard receives the full snippet including the lifecycle wiring.
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('_evermore_install_shell_integration'),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('add-zsh-hook preexec _evermore_preexec'),
    );
    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('\\e]633;E;'));
    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('\\e]133;A'));
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('zle -A _evermore_zle_line_init zle-line-init'),
    );
  });

  it('shows an inline error when clipboard access is unavailable', () => {
    // Given: the browser environment does not expose clipboard access.
    Reflect.deleteProperty(navigator, 'clipboard');
    render(<RecommendedSetupSection />);

    // When: the user tries to copy a snippet.
    fireEvent.click(screen.getByRole('button', { name: 'Copy Shell integration (zsh) snippet' }));

    // Then: the copy failure is surfaced without persisting any setting.
    expect(screen.getByText('Copy failed')).toBeInTheDocument();
  });
});
