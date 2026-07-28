import {
  AGENT_USER_PROMPT_HOOK_MAX_CHARS,
  OSC_777_PAYLOAD_MAX_BYTES,
} from '../pane-integration-constants';
import { AGENT_USER_PROMPT_SUBMIT_EVENT } from '../pane-runtime-signal';

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
 * Two invariants shape the structure below and must survive any edit:
 *
 *  - **Hook JSON and the assembled payload reach `jq` through stdin, never through `argv`.** Hook
 *    stdin can contain the user's prompt, and therefore credentials, customer data, or unreleased
 *    source. Process arguments are world-readable on a shared host, so nothing derived from hook
 *    input may be passed with `--arg`. The number of `jq` invocations is free to vary; only the
 *    transport into them is fixed.
 *  - **A status update always reaches Evermore.** `parseEvermoreAgentEvent()` discards an entire
 *    OSC 777 event once its payload exceeds `OSC_777_PAYLOAD_MAX_BYTES`, so an oversized optional
 *    field would take the status indicator down with it. The script measures the assembled payload
 *    and degrades it — first without the prompt, then to the bare status fields — rather than
 *    emitting something that will be dropped.
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
# Keep /dev/tty as the production path; the override lets tests and nonstandard terminal hosts
# provide an equivalent out-of-band destination without mixing OSC bytes into hook stdout.
TTY_DEVICE="\${EVERMORE_AGENT_TTY_PATH:-/dev/tty}"
PAYLOAD_MAX_BYTES=${OSC_777_PAYLOAD_MAX_BYTES}
PROMPT_MAX_CHARS=${AGENT_USER_PROMPT_HOOK_MAX_CHARS}

case "$AGENT" in
  claude|codex|antigravity|cursor) ;;
  *) printf '{}\\n'; exit 0 ;;
esac

case "$STATUS" in
  running|awaiting-input|complete) ;;
  *) printf '{}\\n'; exit 0 ;;
esac

# Debug logging is opt-in and may capture payloads, so the log is created with owner-only
# permissions instead of inheriting whatever umask (or /tmp default) happens to be in effect.
log_debug() {
  [ -n "\${EVERMORE_HOOK_DEBUG:-}" ] || return 0
  LOG="\${EVERMORE_HOOK_LOG:-/tmp/evermore-agent-hook.log}"
  if [ ! -f "$LOG" ]; then
    (umask 077; : > "$LOG") 2>/dev/null || return 0
  fi
  chmod 600 "$LOG" 2>/dev/null || true
  printf '%s %s\\n' "$(date +%T)" "$1" >> "$LOG" || true
}

if [ -t 0 ]; then
  HOOK_INPUT=""
else
  HOOK_INPUT="$(cat || true)"
fi

if ! command -v jq >/dev/null 2>&1; then
  log_debug 'jq not found'
  printf '{}\\n'
  exit 0
fi

# $1 is "true" to include the submitted prompt, "false" to leave it out for the first degradation
# step. Hook JSON arrives on stdin (-Rs reads it as one raw string) so it never appears in argv.
build_payload() {
  printf '%s' "$HOOK_INPUT" | jq -Rsc \\
    --arg agent "$AGENT" \\
    --arg status "$STATUS" \\
    --arg event "$EVENT" \\
    --argjson withPrompt "$1" \\
    --argjson promptMaxChars "$PROMPT_MAX_CHARS" '
      def string_field($name; $value):
        if ($value | type) == "string" and ($value | length) > 0
        then {($name): $value}
        else {}
        end;

      def hook_tool_name($h):
        $h.tool_name // $h.toolName // "";

      def apply_patch_target($tool; $tool_input):
        if $tool == "apply_patch" and (($tool_input.command // null) | type) == "string"
        then try (
          $tool_input.command
          | capture("[*][*][*] (?:Update|Add|Delete) File: (?<path>[^\\\\r\\\\n]+)")
          | .path
        ) catch null
        else null
        end;

      def target_hint($h):
        (hook_tool_name($h)) as $tool
        | ($h.tool_input // null) as $tool_input
        | if ($tool_input | type) == "object"
          then (
            apply_patch_target($tool; $tool_input) //
            $tool_input.file_path //
            if $tool == "apply_patch" then null else $tool_input.command end //
            $tool_input.pattern //
            $tool_input.description //
            null
          )
          else null
          end;

      def built_activity_label($h):
        if $status == "awaiting-input" then
          (target_hint($h)) as $t
          | if ($t // "" | length) > 0 then "Waiting for approval: \\($t)" else "Waiting for approval" end
        elif $event == "post_tool_use" then
          (hook_tool_name($h)) as $tool
          | (target_hint($h)) as $t
          | if ($tool | length) == 0 then null
            elif ($t // "" | length) > 0 then "\\($tool): \\($t)"
            else $tool
            end
        else null
        end;

      # Replaces control characters with spaces. Evermore sanitizes the text again for display, so
      # the point here is purely arithmetic: an escaped control character costs six bytes as \\uXXXX,
      # which would make the payload size unpredictable from the character count alone.
      # explode/implode is used rather than a regex because it operates on code points directly and
      # does not depend on how the regex engine spells a control-character range.
      #
      # Line feeds are the exception, kept because prompts are routinely written as lists or
      # paragraphs and that structure is worth showing. They cost nothing here: JSON has a short
      # escape for them, so a newline is two bytes rather than six, and the character limit still
      # bounds the total. Carriage returns are dropped rather than turned into line feeds, so CRLF
      # input yields one break; mapping them would produce two, since this walks code points
      # individually and cannot see the pair.
      def scrub_control_chars:
        explode
        | map(if . == 10 then . elif . == 13 then empty elif . < 32 or . == 127 then 32 else . end)
        | implode;

      # Restricted to the prompt-submission event on purpose. Reading any "prompt"-shaped key
      # wherever one appears would let subagent instructions or tool arguments surface in the UI as
      # if the user had typed them.
      def submitted_prompt($h):
        if $withPrompt and $event == "${AGENT_USER_PROMPT_SUBMIT_EVENT}"
        then (
          ($h.prompt // $h.user_prompt // $h.userPrompt // null) as $p
          | if ($p | type) == "string"
            then ($p | scrub_control_chars | .[0:$promptMaxChars])
            else null
            end
        )
        else null
        end;

      ((try fromjson catch {}) | if type == "object" then . else {} end) as $in
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
        + string_field("activityLabel"; built_activity_label($in))
        + string_field("userPrompt"; submitted_prompt($in))
    '
}

# Only the validated agent/status enums reach argv here; nothing from hook stdin does.
build_minimal_payload() {
  jq -cn --arg agent "$AGENT" --arg status "$STATUS" \\
    '{ v: 1, type: "agent-status", agent: $agent, status: $status }'
}

payload_byte_length() {
  printf '%s' "$1" | wc -c | tr -d '[:space:]'
}

payload_fits() {
  [ -n "$1" ] && [ "$(payload_byte_length "$1")" -le "$PAYLOAD_MAX_BYTES" ]
}

# Character limits make an oversized payload unlikely, not impossible: cwd, sessionId and
# activityLabel are all unbounded here, and activityLabel can carry a whole Bash heredoc. Measuring
# the real byte count is what turns "status always arrives" into a guarantee.
PAYLOAD="$(build_payload true || printf '')"
if ! payload_fits "$PAYLOAD"; then
  PAYLOAD="$(build_payload false || printf '')"
  if ! payload_fits "$PAYLOAD"; then
    PAYLOAD="$(build_minimal_payload)"
  fi
fi

if [ -n "\${EVERMORE_HOOK_DEBUG:-}" ]; then
  LOG_PAYLOAD="$(
    printf '%s' "$PAYLOAD" \\
      | jq -c 'if has("userPrompt") then .userPrompt = "[redacted]" else . end' \\
      || printf ''
  )"
  log_debug "$AGENT emit $STATUS $LOG_PAYLOAD"
fi

case "$TRANSPORT" in
  terminalSequence)
    printf '%s' "$PAYLOAD" | jq -Rsc '{ terminalSequence: ("\\u001b]777;evermore;" + . + "\\u0007") }'
    ;;
  tty)
    if [ -w "$TTY_DEVICE" ]; then
      printf '\\033]777;evermore;%s\\a' "$PAYLOAD" > "$TTY_DEVICE" || true
    else
      log_debug "$TTY_DEVICE not writable"
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
