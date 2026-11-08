import { describe, expect, it } from 'vite-plus/test';
import { isOpenInWorkspaceChord, OPEN_IN_WORKSPACE_HINT } from './open-in-workspace-shortcut';

describe('open-in-workspace shortcut', () => {
  it('derives its hint from the accelerator', () => {
    // Given / When: the hint is read.
    // Then: it uses the same keycap symbols as configurable shortcuts.
    expect(OPEN_IN_WORKSPACE_HINT).toBe('⌘ ↵');
  });

  it('matches Command+Enter without other modifiers', () => {
    // Given: Cmd+Enter and its near misses.
    const press = (init: KeyboardEventInit): boolean =>
      isOpenInWorkspaceChord(new KeyboardEvent('keydown', init));

    // When / Then: only the exact chord matches.
    expect(press({ key: 'Enter', metaKey: true })).toBe(true);
    expect(press({ key: 'Enter' })).toBe(false);
    expect(press({ key: 'a', metaKey: true })).toBe(false);
    for (const modifier of ['ctrlKey', 'altKey', 'shiftKey'] as const) {
      expect(press({ key: 'Enter', metaKey: true, [modifier]: true })).toBe(false);
    }
    expect(press({ key: 'Enter', metaKey: true, isComposing: true })).toBe(false);
  });
});
