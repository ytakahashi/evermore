import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBOARD_SHORTCUT_ACTION_IDS,
  KEYBOARD_SHORTCUT_ACTION_ID_SET,
  ACTION_LABELS,
  getReservedAccelerators,
  isKeyboardShortcutActionId,
  type MenuTemplateNode,
} from './keyboard-shortcuts';

describe('keyboard-shortcuts', () => {
  it('keeps DEFAULT_KEYBINDINGS, ACTION_LABELS, and the action id set in sync', () => {
    // Given: the canonical action id list.
    const ids = KEYBOARD_SHORTCUT_ACTION_IDS;

    // When / Then: every id has a default accelerator and a UI label, and nothing else slips in.
    expect(new Set(ids)).toEqual(KEYBOARD_SHORTCUT_ACTION_ID_SET);
    expect(Object.keys(DEFAULT_KEYBINDINGS).sort()).toEqual([...ids].sort());
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...ids].sort());
  });

  it('classifies unknown ids as non-actions', () => {
    expect(isKeyboardShortcutActionId('workspace.newTab')).toBe(true);
    expect(isKeyboardShortcutActionId('workspace.unknown')).toBe(false);
    expect(isKeyboardShortcutActionId(42)).toBe(false);
    expect(isKeyboardShortcutActionId(undefined)).toBe(false);
  });

  describe('getReservedAccelerators', () => {
    it('collects accelerators from a flat template', () => {
      // Given: a single-level template with two items.
      const template: readonly MenuTemplateNode[] = [
        { accelerator: 'Command+T' },
        { accelerator: 'Command+W' },
        {},
      ];

      // When: reserved accelerators are extracted.
      const result = getReservedAccelerators(template);

      // Then: only the non-empty accelerator strings are present.
      expect(result).toEqual(new Set(['Command+T', 'Command+W']));
    });

    it('recurses into submenu trees and ignores empty / missing accelerators', () => {
      // Given: a nested template that mirrors the application menu shape.
      const template: readonly MenuTemplateNode[] = [
        {
          submenu: [
            { accelerator: 'Command+T' },
            { accelerator: '' },
            {
              submenu: [{ accelerator: 'Command+Option+Left' }],
            },
          ],
        },
        { accelerator: 'Command+Q' },
      ];

      // When: reserved accelerators are extracted.
      const result = getReservedAccelerators(template);

      // Then: every depth contributes; the empty accelerator is dropped.
      expect(result).toEqual(new Set(['Command+T', 'Command+Option+Left', 'Command+Q']));
    });
  });
});
