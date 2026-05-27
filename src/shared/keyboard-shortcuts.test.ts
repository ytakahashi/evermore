import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  KEYBOARD_SHORTCUT_ACTION_IDS,
  KEYBOARD_SHORTCUT_ACTION_ID_SET,
  ACTION_LABELS,
  ROLE_ACCELERATORS,
  STANDARD_ROLE_ACCELERATOR_SET,
  formatAcceleratorForDisplay,
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

  describe('STANDARD_ROLE_ACCELERATOR_SET', () => {
    it('exposes the canonical macOS role accelerators in renderer-canonical order', () => {
      // Given: the user-facing accelerator picker emits strings ordered Command → Control →
      // Option → Shift with `Option` (not `Alt`). The conflict-warning set must use the same form
      // so exact-equality lookups succeed.

      // When / Then: a sampling of common role bindings is present in the canonical form.
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+C')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+V')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Q')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Shift+Z')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Option+H')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Control+F')).toBe(true);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Option+I')).toBe(true);
    });

    it('does not leak the non-canonical aliases Electron also accepts', () => {
      // Given: Electron treats `Shift+Command+Z` and `Alt` as equivalents at runtime, but exact
      // string equality with the picker output requires the canonical form to win in the set.

      // Then: the non-canonical aliases are absent so a user-entered canonical value can never
      // miss a match.
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Shift+Command+Z')).toBe(false);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Command+Alt+H')).toBe(false);
      expect(STANDARD_ROLE_ACCELERATOR_SET.has('Alt+Command+I')).toBe(false);
    });

    it('covers every entry declared in ROLE_ACCELERATORS', () => {
      // Given / When / Then: the frozen set is derived from the table, so every value must round-trip.
      for (const accelerator of Object.values(ROLE_ACCELERATORS)) {
        expect(STANDARD_ROLE_ACCELERATOR_SET.has(accelerator)).toBe(true);
      }
    });
  });

  describe('formatAcceleratorForDisplay', () => {
    const cmd = String.fromCodePoint(0x2318);
    const opt = String.fromCodePoint(0x2325);
    const shift = String.fromCodePoint(0x21e7);
    const ctrl = String.fromCodePoint(0x2303);
    const left = String.fromCodePoint(0x2190);
    const right = String.fromCodePoint(0x2192);
    const up = String.fromCodePoint(0x2191);
    const down = String.fromCodePoint(0x2193);
    const enter = String.fromCodePoint(0x21b5);
    const escape = String.fromCodePoint(0x238b);
    const forwardDelete = String.fromCodePoint(0x2326);
    const tab = String.fromCodePoint(0x21e5);

    it('maps modifiers and named keys to macOS keycap symbols separated by spaces', () => {
      expect(formatAcceleratorForDisplay('Command+T')).toBe(`${cmd} T`);
      expect(formatAcceleratorForDisplay('Command+Shift+D')).toBe(`${shift} ${cmd} D`);
      expect(formatAcceleratorForDisplay('Command+Option+Left')).toBe(`${opt} ${cmd} ${left}`);
      expect(formatAcceleratorForDisplay('Command+Option+Right')).toBe(`${opt} ${cmd} ${right}`);
      expect(formatAcceleratorForDisplay('Command+Option+Up')).toBe(`${opt} ${cmd} ${up}`);
      expect(formatAcceleratorForDisplay('Command+Option+Down')).toBe(`${opt} ${cmd} ${down}`);
    });

    it('reorders modifiers to Control → Option → Shift → Command regardless of stored order', () => {
      // Given: stored accelerators are emitted Command-first by the picker, but the macOS HIG
      // display order puts Command last.
      expect(formatAcceleratorForDisplay('Command+Control+Option+Shift+K')).toBe(
        `${ctrl} ${opt} ${shift} ${cmd} K`,
      );
    });

    it('renders named non-modifier keys as their symbols', () => {
      expect(formatAcceleratorForDisplay('Command+Enter')).toBe(`${cmd} ${enter}`);
      expect(formatAcceleratorForDisplay('Command+Escape')).toBe(`${cmd} ${escape}`);
      expect(formatAcceleratorForDisplay('Command+Delete')).toBe(`${cmd} ${forwardDelete}`);
      expect(formatAcceleratorForDisplay('Command+Tab')).toBe(`${cmd} ${tab}`);
    });

    it('passes punctuation and word keys through unchanged', () => {
      expect(formatAcceleratorForDisplay('Command+,')).toBe(`${cmd} ,`);
      expect(formatAcceleratorForDisplay('Command+[')).toBe(`${cmd} [`);
      expect(formatAcceleratorForDisplay('Command+]')).toBe(`${cmd} ]`);
      expect(formatAcceleratorForDisplay('Command+Space')).toBe(`${cmd} Space`);
    });

    it('returns an empty string for an empty input', () => {
      expect(formatAcceleratorForDisplay('')).toBe('');
    });
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
