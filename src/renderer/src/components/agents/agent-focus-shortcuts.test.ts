import { describe, expect, it } from 'vite-plus/test';
import {
  FOCUS_LIST_HINT,
  FOCUS_TERMINAL_HINT,
  getAgentFocusDirection,
} from './agent-focus-shortcuts';

describe('agent focus shortcuts', () => {
  it('formats the fixed chords consistently with other shortcuts', () => {
    // Given / When: the hints are read.
    // Then: Command and arrow symbols identify the two directions.
    expect(FOCUS_LIST_HINT).toBe('⌘ ←');
    expect(FOCUS_TERMINAL_HINT).toBe('⌘ →');
  });

  it.each([
    ['ArrowLeft', 'list'],
    ['ArrowRight', 'terminal'],
  ] as const)('matches only the exact Command chord for %s', (key, direction) => {
    // Given: a fixed focus chord and events that differ by a modifier or composition state.
    const press = (init: KeyboardEventInit): ReturnType<typeof getAgentFocusDirection> =>
      getAgentFocusDirection(new KeyboardEvent('keydown', init));

    // When / Then: only the unmodified Command chord matches.
    expect(press({ key, metaKey: true })).toBe(direction);
    expect(press({ key })).toBeNull();
    for (const modifier of ['ctrlKey', 'altKey', 'shiftKey', 'isComposing'] as const) {
      expect(press({ key, metaKey: true, [modifier]: true })).toBeNull();
    }
    expect(press({ key, metaKey: true, keyCode: 229 })).toBeNull();
    expect(press({ key: 'Enter', metaKey: true })).toBeNull();
  });
});
