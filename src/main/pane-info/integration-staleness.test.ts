import { describe, expect, it } from 'vitest';
import { PANE_INTEGRATION } from '../../shared/pane-integration-constants';
import type { PaneIntegrationInfo } from '../../shared/types';
import { isIntegrationStale } from './integration-staleness';

function integration(overrides: Partial<PaneIntegrationInfo> = {}): PaneIntegrationInfo {
  return {
    shell: true,
    protocols: ['osc133'],
    lastSequenceAt: 1000,
    stale: false,
    ...overrides,
  };
}

describe('isIntegrationStale', () => {
  it('does not mark panes stale before shell integration is observed', () => {
    // Given: a pane has missed process starts but has never emitted shell integration.
    const info = integration({ shell: false, protocols: [], lastSequenceAt: 0 });

    // When: stale state is computed.
    const stale = isIntegrationStale(info, PANE_INTEGRATION.STALE_AFTER_MISSED_COMMANDS, 10_000);

    // Then: stale semantics are disabled for panes without shell integration history.
    expect(stale).toBe(false);
  });

  it('marks integration stale once missed command starts reach the command threshold', () => {
    // Given: shell integration was observed and ps has seen enough starts without matching OSC.
    const info = integration();

    // When: stale state is computed at the command-count threshold.
    const stale = isIntegrationStale(info, PANE_INTEGRATION.STALE_AFTER_MISSED_COMMANDS, 2000);

    // Then: the integration is considered stale.
    expect(stale).toBe(true);
  });

  it('keeps integration active below the command threshold without wall-clock fallback', () => {
    // Given: shell integration has only missed one ps start.
    const info = integration();

    // When: stale state is computed shortly after the last sequence.
    const stale = isIntegrationStale(info, PANE_INTEGRATION.STALE_AFTER_MISSED_COMMANDS - 1, 2000);

    // Then: one missed start alone is not enough to go stale.
    expect(stale).toBe(false);
  });

  it('uses wall-clock fallback only after at least one missed command start', () => {
    // Given: shell integration has been quiet longer than the wall-clock threshold.
    const now = 1000 + PANE_INTEGRATION.STALE_AFTER_WALL_CLOCK_MS + 1;

    // When/Then: long idle time alone is not stale, but one missed start plus long quiet time is.
    expect(isIntegrationStale(integration(), 0, now)).toBe(false);
    expect(isIntegrationStale(integration(), 1, now)).toBe(true);
  });
});
