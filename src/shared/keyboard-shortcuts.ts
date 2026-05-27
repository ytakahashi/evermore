/**
 * Single source of truth for Evermore's keyboard shortcut action ids, their default accelerators,
 * and the labels surfaced in Settings UI and the menu bar.
 *
 * The macOS application menu owns accelerator resolution: the main process renders this map into
 * `Menu.setApplicationMenu(...)` and dispatches the matched action over IPC, so the renderer never
 * installs its own keydown hook for these shortcuts. macOS-only project: accelerators use
 * `Command` / `Option` / `Control` / `Shift` and never `CommandOrControl`.
 */

export type KeyboardShortcutActionId =
  | 'workspace.newTab'
  | 'workspace.closeTab'
  | 'workspace.nextTab'
  | 'workspace.previousTab'
  | 'pane.splitVertical'
  | 'pane.splitHorizontal'
  | 'pane.focusLeft'
  | 'pane.focusRight'
  | 'pane.focusUp'
  | 'pane.focusDown'
  | 'pane.toggleFullscreen'
  | 'ui.toggleSidebar'
  | 'ui.openSettings';

export const KEYBOARD_SHORTCUT_ACTION_IDS: readonly KeyboardShortcutActionId[] = [
  'workspace.newTab',
  'workspace.closeTab',
  'workspace.nextTab',
  'workspace.previousTab',
  'pane.splitVertical',
  'pane.splitHorizontal',
  'pane.focusLeft',
  'pane.focusRight',
  'pane.focusUp',
  'pane.focusDown',
  'pane.toggleFullscreen',
  'ui.toggleSidebar',
  'ui.openSettings',
] as const;

export const KEYBOARD_SHORTCUT_ACTION_ID_SET: ReadonlySet<KeyboardShortcutActionId> = new Set(
  KEYBOARD_SHORTCUT_ACTION_IDS,
);

export function isKeyboardShortcutActionId(value: unknown): value is KeyboardShortcutActionId {
  return (
    typeof value === 'string' &&
    KEYBOARD_SHORTCUT_ACTION_ID_SET.has(value as KeyboardShortcutActionId)
  );
}

/**
 * Default accelerator per action id. Stored as Electron Accelerator strings so the same value can
 * flow into a `MenuItemConstructorOptions.accelerator` field unchanged.
 */
export const DEFAULT_KEYBINDINGS: Record<KeyboardShortcutActionId, string> = {
  'workspace.newTab': 'Command+T',
  'workspace.closeTab': 'Command+W',
  'workspace.nextTab': 'Command+]',
  'workspace.previousTab': 'Command+[',
  'pane.splitVertical': 'Command+D',
  'pane.splitHorizontal': 'Command+Shift+D',
  'pane.focusLeft': 'Command+Option+Left',
  'pane.focusRight': 'Command+Option+Right',
  'pane.focusUp': 'Command+Option+Up',
  'pane.focusDown': 'Command+Option+Down',
  'pane.toggleFullscreen': 'Command+Shift+F',
  'ui.toggleSidebar': 'Command+B',
  'ui.openSettings': 'Command+,',
};

export const ACTION_LABELS: Record<KeyboardShortcutActionId, string> = {
  'workspace.newTab': 'New Tab',
  'workspace.closeTab': 'Close Tab',
  'workspace.nextTab': 'Next Tab',
  'workspace.previousTab': 'Previous Tab',
  'pane.splitVertical': 'Split Vertically',
  'pane.splitHorizontal': 'Split Horizontally',
  'pane.focusLeft': 'Focus Left Pane',
  'pane.focusRight': 'Focus Right Pane',
  'pane.focusUp': 'Focus Upper Pane',
  'pane.focusDown': 'Focus Lower Pane',
  'pane.toggleFullscreen': 'Toggle Pane Full Screen',
  'ui.toggleSidebar': 'Toggle Sidebar',
  'ui.openSettings': 'Preferences…',
};

/**
 * Structural subset of Electron's `MenuItemConstructorOptions` used by `getReservedAccelerators`.
 *
 * Defined here in `shared/` so both Settings UI (renderer) and `buildApplicationMenu` tests (main)
 * can derive the reserved accelerator set from the same template object. Kept as a structural type
 * to avoid taking an `electron` dependency from `shared/`.
 */
export interface MenuTemplateNode {
  accelerator?: string;
  submenu?: readonly MenuTemplateNode[];
}

/**
 * Collects every `accelerator` string from a menu template, walking into `submenu` recursively.
 *
 * Used to surface accelerator conflict warnings in Settings UI: any accelerator the application
 * menu has already reserved (Evermore actions plus standard role items such as `Cmd+C` / `Cmd+V` /
 * `Cmd+Q`) is reported as a conflict source, keeping the warning set in sync with the menu
 * structure rather than a hardcoded list.
 */
export function getReservedAccelerators(template: readonly MenuTemplateNode[]): Set<string> {
  const result = new Set<string>();
  const visit = (nodes: readonly MenuTemplateNode[]): void => {
    for (const node of nodes) {
      if (typeof node.accelerator === 'string' && node.accelerator.length > 0) {
        result.add(node.accelerator);
      }
      if (node.submenu) {
        visit(node.submenu);
      }
    }
  };
  visit(template);
  return result;
}

/**
 * macOS-standard accelerators for the Electron menu roles Evermore exposes in its application
 * menu. Written in the renderer's canonical modifier order
 * (`Command` → `Control` → `Option` → `Shift`) and using `Option` instead of `Alt`, matching what
 * the Settings UI's accelerator picker produces. Electron's Accelerator parser treats different
 * orderings and `Alt`/`Option` as equivalent, so the runtime binding is unchanged; aligning the
 * string lets exact-equality conflict checks succeed against user-entered values.
 *
 * Lives in `shared/` so the main process menu builder and the renderer Settings UI consume the
 * same table — drifting them by hand was how earlier revisions missed `Cmd+C` / `Cmd+V` conflict
 * warnings.
 *
 * `toggleDevTools` is intentionally listed even though the menu builder only includes the item in
 * development builds: warning the user that `Command+Option+I` is reserved is harmless in
 * production and avoids threading `isDev` into the renderer just for one binding.
 */
export const ROLE_ACCELERATORS = {
  undo: 'Command+Z',
  redo: 'Command+Shift+Z',
  cut: 'Command+X',
  copy: 'Command+C',
  paste: 'Command+V',
  selectAll: 'Command+A',
  quit: 'Command+Q',
  hide: 'Command+H',
  hideOthers: 'Command+Option+H',
  minimize: 'Command+M',
  togglefullscreen: 'Command+Control+F',
  toggleDevTools: 'Command+Option+I',
} as const;

/**
 * Frozen set of every accelerator in {@link ROLE_ACCELERATORS}. Used by Settings UI to warn when
 * a user-supplied keybinding collides with a standard macOS role binding.
 */
export const STANDARD_ROLE_ACCELERATOR_SET: ReadonlySet<string> = new Set(
  Object.values(ROLE_ACCELERATORS),
);

/**
 * macOS keycap symbols for the modifiers used in stored Electron accelerator strings. The display
 * layer renders these instead of the raw `Command`/`Option`/`Shift`/`Control` tokens so the
 * Settings UI matches the symbols printed on Apple keyboards and used by the macOS menu bar.
 */
const MODIFIER_SYMBOLS: Readonly<Record<string, string>> = {
  Control: '⌃',
  Option: '⌥',
  Shift: '⇧',
  Command: '⌘',
};

/**
 * Display order for stacked modifiers, matching Apple's Human Interface Guidelines
 * (Control → Option → Shift → Command). The order in stored accelerator strings is Command-first
 * (see {@link eventToAccelerator} in the renderer); the display layer re-sorts on render so the
 * persisted string stays unchanged.
 */
const MODIFIER_DISPLAY_ORDER: readonly string[] = ['Control', 'Option', 'Shift', 'Command'];

/**
 * Symbols for named non-modifier keys. Single-character tokens (letters, digits, punctuation such
 * as `,` / `[`) pass through unchanged. `Space` stays as the word "Space" — the open-box glyph
 * (`␣`) is visually too close to underscore at small sizes to be readable here.
 */
const NAMED_KEY_SYMBOLS: Readonly<Record<string, string>> = {
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  Enter: '↵',
  Tab: '⇥',
  Escape: '⎋',
  // Electron's `Delete` token is the Forward Delete key (fn+delete on Apple keyboards). Plain
  // Backspace is intercepted by the picker as "clear this binding" and never reaches an accelerator
  // string, so the `⌫` glyph printed on the main delete key would misrepresent what was bound.
  // Use `⌦` (U+2326) — the Forward Delete symbol — to match what the user actually pressed.
  Delete: '⌦',
};

/**
 * Formats a stored Electron accelerator string (e.g. `"Command+Option+Left"`) into a macOS-style
 * keycap display string (e.g. `"⌥ ⌘ ←"`). Tokens are separated by a single space so each glyph
 * stays visually distinct without per-key borders.
 *
 * The function only rewrites the visual form — the persisted accelerator format is unchanged, so
 * Electron's menu builder and conflict detection keep using the canonical token strings.
 */
export function formatAcceleratorForDisplay(accelerator: string): string {
  if (accelerator.length === 0) {
    return '';
  }

  // Split on `+` but only when it acts as a separator. A trailing `+` token (e.g. `"Shift++"` for
  // the `+` key on a non-US layout) would otherwise produce an empty segment; preserve it as the
  // literal `+` key by detecting the trailing-empty case.
  const rawParts = accelerator.split('+');
  const parts =
    rawParts.length >= 2 && rawParts[rawParts.length - 1] === ''
      ? [...rawParts.slice(0, -2), '+']
      : rawParts;

  const presentModifiers = new Set<string>();
  let keyPart: string | null = null;
  for (const part of parts) {
    if (part in MODIFIER_SYMBOLS) {
      presentModifiers.add(part);
    } else {
      keyPart = part;
    }
  }

  const tokens: string[] = [];
  for (const modifier of MODIFIER_DISPLAY_ORDER) {
    if (presentModifiers.has(modifier)) {
      tokens.push(MODIFIER_SYMBOLS[modifier] as string);
    }
  }
  if (keyPart !== null && keyPart.length > 0) {
    tokens.push(NAMED_KEY_SYMBOLS[keyPart] ?? keyPart);
  }

  return tokens.join(' ');
}
