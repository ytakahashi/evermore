import { describe, expect, it } from 'vitest';
import { classifyForegroundSession } from './foreground-session';

describe('classifyForegroundSession', () => {
  it('classifies idle sessions as none regardless of foreground args', () => {
    // Given: a pane is idle even if the caller still has cached foreground args.

    // When: the session is classified.
    const session = classifyForegroundSession('idle', '/usr/bin/ssh user@host');

    // Then: idle panes do not expose a foreground session.
    expect(session).toEqual({ kind: 'none' });
  });

  it.each([['ssh user@host'], ['/usr/bin/ssh user@host']])(
    'classifies %s as ssh',
    (foregroundArgs) => {
      // Given: local ps reports ssh as the foreground process token.

      // When: the session is classified.
      const session = classifyForegroundSession('running', foregroundArgs);

      // Then: the foreground session is marked as ssh.
      expect(session).toEqual({ kind: 'ssh' });
    },
  );

  it.each([
    ['sudo ssh user@host'],
    ['ssh-keygen -lf id_rsa.pub'],
    ['/usr/local/bin/myconnect user@host'],
    [undefined],
  ])('classifies %s as other when running', (foregroundArgs) => {
    // Given: local ps does not report ssh itself as the foreground executable token.

    // When: the session is classified.
    const session = classifyForegroundSession('running', foregroundArgs);

    // Then: the foreground session remains a generic local process.
    expect(session).toEqual({ kind: 'other' });
  });
});
