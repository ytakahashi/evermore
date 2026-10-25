// Bound hand-edited files and IPC payloads. These mirror `MAX_PROJECT_DIRECTORIES` and
// `MAX_SETTINGS_STRING_LENGTH` in the main settings store; keep them in sync when changing either.
export const MAX_AGENT_PRESETS = 500;
export const MAX_AGENT_PRESET_STRING_LENGTH = 4_096;

/** Validates editable fields without rewriting user-authored shell syntax or whitespace. */
export function getAgentPresetFieldsError(label: string, command: string): string | null {
  if (!command.trim()) return 'Command is required.';
  if (
    label.length > MAX_AGENT_PRESET_STRING_LENGTH ||
    command.length > MAX_AGENT_PRESET_STRING_LENGTH
  ) {
    return `Label and command must be at most ${MAX_AGENT_PRESET_STRING_LENGTH} characters.`;
  }
  return null;
}
