/**
 * Allowed range for `terminal.scrollback` (lines kept per pane in the xterm normal buffer).
 *
 * The floor matches xterm's built-in default so a hand-edited value can never shrink history
 * below what panes had before the setting existed. The ceiling bounds renderer memory: xterm
 * stores roughly 12 bytes per cell, so a 200-column pane at 50,000 lines holds about 120MB, and
 * every open pane keeps its own buffer.
 */
export const TERMINAL_SCROLLBACK_MIN = 1_000;
export const TERMINAL_SCROLLBACK_MAX = 50_000;
