import { formatAcceleratorForDisplay } from '../../../../shared/keyboard-shortcuts';

/**
 * Fixed chord that opens an agent session in its workspace from the Agents view.
 *
 * Stored in the same Electron accelerator format as configurable keybindings so the display goes
 * through {@link formatAcceleratorForDisplay}; {@link isOpenInWorkspaceChord} and
 * {@link OPEN_IN_WORKSPACE_ARIA_KEYSHORTCUTS} must describe the same chord.
 */
export const OPEN_IN_WORKSPACE_ACCELERATOR = 'Command+Enter';

/** `aria-keyshortcuts` form of {@link OPEN_IN_WORKSPACE_ACCELERATOR}. */
export const OPEN_IN_WORKSPACE_ARIA_KEYSHORTCUTS = 'Meta+Enter';

/** Keycap label for {@link OPEN_IN_WORKSPACE_ACCELERATOR}, e.g. `⌘ ↵`. */
export const OPEN_IN_WORKSPACE_HINT = formatAcceleratorForDisplay(OPEN_IN_WORKSPACE_ACCELERATOR);

/**
 * Returns whether a keydown is exactly {@link OPEN_IN_WORKSPACE_ACCELERATOR}, outside IME
 * composition.
 */
export function isOpenInWorkspaceChord(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    // WebKit can report `isComposing: false` for the key that ends composition.
    !event.isComposing &&
    event.keyCode !== 229
  );
}
