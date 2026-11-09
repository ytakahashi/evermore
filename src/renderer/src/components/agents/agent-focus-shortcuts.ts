import { formatAcceleratorForDisplay } from '../../../../shared/keyboard-shortcuts';
import { isExactCommandChord } from '../common/command-chord';

/** Fixed chord for returning from the agent terminal to the list. */
export const FOCUS_LIST_ACCELERATOR = 'Command+Left';

/** Fixed chord for focusing the previewed agent terminal from the list. */
export const FOCUS_TERMINAL_ACCELERATOR = 'Command+Right';

/** Keycap label for returning from the agent terminal to the list. */
export const FOCUS_LIST_HINT = formatAcceleratorForDisplay(FOCUS_LIST_ACCELERATOR);

/** Keycap label for focusing the previewed agent terminal from the list. */
export const FOCUS_TERMINAL_HINT = formatAcceleratorForDisplay(FOCUS_TERMINAL_ACCELERATOR);

/**
 * Resolves the fixed Agents focus chords, excluding extra modifiers and IME composition.
 * These stay view-local because menu accelerators would also steal line navigation from sidebar
 * rename fields and Settings inputs.
 */
export function getAgentFocusDirection(event: KeyboardEvent): 'list' | 'terminal' | null {
  if (!isExactCommandChord(event)) return null;
  if (event.key === 'ArrowLeft') return 'list';
  if (event.key === 'ArrowRight') return 'terminal';
  return null;
}
