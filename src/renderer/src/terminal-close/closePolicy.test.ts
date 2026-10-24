import { describe, expect, it } from 'vite-plus/test';
import type { ConfirmMode, PaneRuntimeInfo } from '../../../shared/types';
import { hasRunningPty, shouldConfirmTerminalClose } from './closePolicy';

function paneInfo(ptyId: string, processActivity: 'idle' | 'running'): PaneRuntimeInfo {
  return {
    ptyId,
    processActivity,
    foregroundSession: { kind: 'none' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    observedAt: 1,
  };
}

describe('terminal-close policy', () => {
  it.each<{
    expected: boolean;
    label: string;
    mode: ConfirmMode;
    runningProcesses: boolean;
  }>([
    {
      label: 'never with running PTY',
      mode: 'never',
      runningProcesses: true,
      expected: false,
    },
    {
      label: 'always with no running PTY',
      mode: 'always',
      runningProcesses: false,
      expected: true,
    },
    {
      label: 'running-only with running PTY',
      mode: 'running-only',
      runningProcesses: true,
      expected: true,
    },
    {
      label: 'running-only with idle PTY',
      mode: 'running-only',
      runningProcesses: false,
      expected: false,
    },
  ])('evaluates $label', ({ expected, mode, runningProcesses }) => {
    // Given: a confirmation mode and the already-resolved activity state.

    // When: the close policy is evaluated.
    const result = shouldConfirmTerminalClose({ mode, runningProcesses });

    // Then: only the configured activity condition requires a prompt.
    expect(result).toBe(expected);
  });

  it('reports whether any PTY is running', () => {
    // Given: idle, missing, and running PTY entries.
    const infos = {
      'pty-idle': paneInfo('pty-idle', 'idle'),
      'pty-running': paneInfo('pty-running', 'running'),
    };

    // When / Then: one running entry is sufficient; unassigned and missing entries are ignored.
    expect(hasRunningPty(['pty-idle', undefined, 'pty-running'], infos)).toBe(true);
    expect(hasRunningPty(['pty-idle', undefined, 'pty-missing'], infos)).toBe(false);
  });
});
