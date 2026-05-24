import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIIntegrationSection } from './AIIntegrationSection';

describe('AIIntegrationSection', () => {
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

  it('renders the helper setup and Claude Code hooks by default', () => {
    // Given: the AI Integration section is visible.
    render(<AIIntegrationSection />);

    // Then: the prerequisite, common helper, and default agent hook are shown for manual setup.
    expect(screen.getByRole('heading', { name: 'AI Integration' })).toBeInTheDocument();
    expect(screen.getByText(/brew install jq/i)).toBeInTheDocument();
    expect(screen.getByText('Evermore agent status helper')).toBeInTheDocument();
    expect(screen.getByText('~/.config/evermore/evermore-agent-status.sh')).toBeInTheDocument();
    expect(screen.queryByText('Helper install commands')).not.toBeInTheDocument();
    expect(screen.getByText('Claude Code hooks')).toBeInTheDocument();
    expect(screen.getByText('~/.claude/settings.json')).toBeInTheDocument();
    expect(screen.getByText(/sidebar shows Claude as running/i)).toBeInTheDocument();
  });

  it('switches between agent-specific hook snippets', () => {
    // Given: the AI Integration section is visible.
    render(<AIIntegrationSection />);

    // When: the user selects the Codex CLI hooks.
    fireEvent.click(screen.getByRole('tab', { name: 'Codex CLI' }));

    // Then: the Codex hook target and sidebar behavior notes are shown.
    expect(screen.getByText('Codex CLI hooks')).toBeInTheDocument();
    expect(screen.getByText('~/.codex/hooks.json')).toBeInTheDocument();
    expect(screen.getByText(/sidebar shows Codex as running/i)).toBeInTheDocument();
    expect(screen.queryByText(/open \/hooks inside Codex TUI/i)).not.toBeInTheDocument();

    // When: the user selects the Antigravity CLI hooks.
    fireEvent.click(screen.getByRole('tab', { name: 'Antigravity CLI' }));

    // Then: the Antigravity target and current sidebar behavior limitation are shown.
    expect(screen.getByText('Antigravity CLI hooks')).toBeInTheDocument();
    expect(screen.getByText('~/.gemini/config/hooks.json')).toBeInTheDocument();
    expect(screen.getByText(/sidebar shows Antigravity as running/i)).toBeInTheDocument();
    expect(screen.getByText(/may not change the sidebar to awaiting input/i)).toBeInTheDocument();
  });

  it('copies only the selected agent snippet', async () => {
    // Given: the Codex CLI snippet is selected.
    render(<AIIntegrationSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'Codex CLI' }));

    // When: the user copies the Codex hook snippet.
    fireEvent.click(screen.getByRole('button', { name: 'Copy Codex CLI hooks snippet' }));
    await act(async () => {
      await Promise.resolve();
    });

    // Then: the clipboard receives the Codex hook JSON without mixing in the helper script.
    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining('evermore-agent-status.sh codex running user_prompt_submit tty'),
    );
    expect(clipboardWriteText).not.toHaveBeenCalledWith(expect.stringContaining('AGENT="${1:-}"'));
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows an inline error when clipboard access is unavailable', () => {
    // Given: the browser environment does not expose clipboard access.
    Reflect.deleteProperty(navigator, 'clipboard');
    render(<AIIntegrationSection />);

    // When: the user tries to copy a snippet.
    fireEvent.click(screen.getByRole('button', { name: 'Copy Claude Code hooks snippet' }));

    // Then: the copy failure is surfaced inline.
    expect(screen.getByText('Copy failed')).toBeInTheDocument();
  });
});
