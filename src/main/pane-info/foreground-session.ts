import type { PaneForegroundSession, PaneProcessActivity } from '../../shared/types';

const SSH_BASENAME_PATTERN = /(?:^|\/)ssh$/;

/**
 * Classifies the foreground session using only local process-table foreground args.
 *
 * Do not pass user-submitted command text or OSC 633 command lines here. Remote shells can emit
 * OSC through an SSH session, but the local foreground session remains the `ssh` process.
 */
export function classifyForegroundSession(
  activity: PaneProcessActivity,
  foregroundArgs: string | undefined,
): PaneForegroundSession {
  if (activity === 'idle') {
    return { kind: 'none' };
  }

  if (!foregroundArgs) {
    return { kind: 'other' };
  }

  const firstToken = foregroundArgs.trim().split(/\s+/, 1)[0] ?? '';
  if (SSH_BASENAME_PATTERN.test(firstToken)) {
    return { kind: 'ssh' };
  }

  return { kind: 'other' };
}
