/**
 * Shared shell helper for AI agent hook integrations.
 *
 * Users save this script as `~/.config/evermore/evermore-agent-status.sh`. It reads hook stdin
 * JSON, normalizes a compact Evermore OSC 777 `agent-status` payload, and emits it either through
 * Claude Code's `terminalSequence` response shape or by writing directly to `/dev/tty`.
 *
 * The script intentionally depends on `jq` so quoted paths, session ids, and tool names are parsed
 * and JSON-escaped by a real JSON tool rather than by shell string handling.
 *
 * When this snippet changes, update the AI integration tests so Settings copy blocks and the shell
 * contract stay in sync.
 */
export const EVERMORE_AGENT_STATUS_HELPER_SCRIPT = `#!/bin/sh
set -eu

AGENT="\${1:-}"
STATUS="\${2:-}"
EVENT="\${3:-}"
TRANSPORT="\${4:-tty}"

case "$AGENT" in
  claude|codex|antigravity|cursor) ;;
  *) printf '{}\\n'; exit 0 ;;
esac

case "$STATUS" in
  running|awaiting-input|complete) ;;
  *) printf '{}\\n'; exit 0 ;;
esac

if [ -t 0 ]; then
  HOOK_INPUT=""
else
  HOOK_INPUT="$(cat || true)"
fi

if ! command -v jq >/dev/null 2>&1; then
  if [ -n "\${EVERMORE_HOOK_DEBUG:-}" ]; then
    LOG="\${EVERMORE_HOOK_LOG:-/tmp/evermore-agent-hook.log}"
    printf '%s jq not found\\n' "$(date +%T)" >> "$LOG"
  fi
  printf '{}\\n'
  exit 0
fi

PAYLOAD="$(
  jq -cn \\
    --arg hook "$HOOK_INPUT" \\
    --arg agent "$AGENT" \\
    --arg status "$STATUS" \\
    --arg event "$EVENT" '
      def parsed_hook:
        if $hook == "" then {}
        else try ($hook | fromjson) catch {}
        end;

      def string_field($name; $value):
        if ($value | type) == "string" and ($value | length) > 0
        then {($name): $value}
        else {}
        end;

      parsed_hook as $in
      | {
          v: 1,
          type: "agent-status",
          agent: $agent,
          status: $status
        }
        + string_field("event"; $event)
        + string_field("sessionId"; ($in.session_id // $in.sessionId // $in.conversationId))
        + string_field("cwd"; (
            $in.cwd //
            if ($in.workspacePaths | type) == "array" then $in.workspacePaths[0] else null end
          ))
        + string_field("toolName"; ($in.tool_name // $in.toolName))
    '
)"

if [ -n "\${EVERMORE_HOOK_DEBUG:-}" ]; then
  LOG="\${EVERMORE_HOOK_LOG:-/tmp/evermore-agent-hook.log}"
  printf '%s %s emit %s %s\\n' "$(date +%T)" "$AGENT" "$STATUS" "$PAYLOAD" >> "$LOG"
fi

case "$TRANSPORT" in
  terminalSequence)
    jq -cn --arg seq "$(printf '\\033]777;evermore;%s\\a' "$PAYLOAD")" \\
      '{ terminalSequence: $seq }'
    ;;
  tty)
    if [ -w /dev/tty ]; then
      printf '\\033]777;evermore;%s\\a' "$PAYLOAD" > /dev/tty || true
    elif [ -n "\${EVERMORE_HOOK_DEBUG:-}" ]; then
      LOG="\${EVERMORE_HOOK_LOG:-/tmp/evermore-agent-hook.log}"
      printf '%s /dev/tty not writable\\n' "$(date +%T)" >> "$LOG"
    fi
    printf '{}\\n'
    ;;
  *)
    printf '{}\\n'
    ;;
esac
`;

/**
 * Claude Code hook configuration that routes Evermore OSC output through `terminalSequence`.
 */
export const CLAUDE_CODE_HOOK_SNIPPET = `{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh claude running user_prompt_submit terminalSequence"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh claude awaiting-input permission_request terminalSequence"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh claude running post_tool_use terminalSequence"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh claude complete stop terminalSequence"
          }
        ]
      }
    ]
  }
}`;

/**
 * Codex CLI hook configuration that emits Evermore OSC output directly to `/dev/tty`.
 */
export const CODEX_CLI_HOOK_SNIPPET = `{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh codex running user_prompt_submit tty",
            "timeout": 5
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh codex awaiting-input permission_request tty",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh codex running post_tool_use tty",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh codex complete stop tty",
            "timeout": 5
          }
        ]
      }
    ]
  }
}`;

/**
 * Antigravity CLI hook configuration that emits running and complete states through `/dev/tty`.
 */
export const ANTIGRAVITY_CLI_HOOK_SNIPPET = `{
  "evermore-integration": {
    "PreInvocation": [
      {
        "type": "command",
        "command": "$HOME/.config/evermore/evermore-agent-status.sh antigravity running pre_invocation tty"
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/.config/evermore/evermore-agent-status.sh antigravity running post_tool_use tty"
          }
        ]
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "$HOME/.config/evermore/evermore-agent-status.sh antigravity complete stop tty"
      }
    ]
  }
}`;
