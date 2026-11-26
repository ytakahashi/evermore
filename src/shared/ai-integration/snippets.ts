import {
  AGENT_SESSION_TITLE_HOOK_MAX_CHARS,
  AGENT_USER_PROMPT_HOOK_MAX_CHARS,
  OSC_777_PAYLOAD_MAX_BYTES,
} from '../pane-integration-constants';
import { AGENT_PRE_INVOCATION_EVENT, AGENT_USER_PROMPT_SUBMIT_EVENT } from '../pane-runtime-signal';

// Titles must occupy one line before entering the payload builder. Strip CR, replace LF and other
// C0/C1 controls with spaces, then truncate by code point. xterm treats U+009C as an OSC terminator.
const SESSION_TITLE_JQ_FILTER = `explode
        | map(if . == 13 then empty elif . < 32 or (. >= 127 and . <= 159) then 32 else . end)
        | implode
        | .[0:$titleMaxChars]`;

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
 *    input may be passed with `--arg`. The same applies to values read from agent-owned files:
 *    those files are opened with a `<` redirect and the session title read from them travels to
 *    `jq` on stdin. The number of `jq` invocations is free to vary; only the transport into them
 *    is fixed.
 *  - **A status update always reaches Evermore.** `parseEvermoreAgentEvent()` discards an entire
 *    OSC 777 event once its payload exceeds `OSC_777_PAYLOAD_MAX_BYTES`, so an oversized optional
 *    field would take the status indicator down with it. The script measures the assembled payload
 *    and degrades it — first without the prompt, then to the bare status fields — rather than
 *    emitting something that will be dropped. The session title survives the first step because
 *    it is short and stays useful across turns.
 *
 * Session titles come from agent-internal storage (Claude Code transcripts or the Codex CLI session
 * index). Neither format has a published specification, so the helper treats lookup and parse
 * failures as a missing title and still sends the status update.
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
TITLE_MAX_CHARS=${AGENT_SESSION_TITLE_HOOK_MAX_CHARS}

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

# Prints the latest Claude Code session title, or nothing. Claude Code appends an ai-title line to
# the transcript each time it regenerates the title, so the last valid one wins. Every candidate is
# validated before tail picks one, so a malformed last line falls back to the previous valid title.
# grep -F only narrows the candidates: string values inside the transcript are JSON-escaped, so a
# prompt or tool output that mentions "type":"ai-title" never matches literally. -a keeps grep in
# text mode even when a corrupted line contains a NUL byte; otherwise macOS grep prints only
# "Binary file ... matches" and every valid title is lost along with the broken one. The C locale lets
# grep compare bytes instead of decoding UTF-8; the marker is ASCII and jq decodes the matched lines
# itself. This is the dominant cost on large transcripts (about 110 ms instead of 180 ms for 17 MB
# with macOS grep).
# Normalize before tail so each title occupies exactly one output line.
read_claude_session_title() {
  TRANSCRIPT_PATH="$(
    printf '%s' "$HOOK_INPUT" | jq -Rsr 'try (fromjson | .transcript_path | strings) catch empty' \\
      2>/dev/null || true
  )"
  [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ] && [ -r "$TRANSCRIPT_PATH" ] || return 0
  LC_ALL=C grep -aF '"type":"ai-title"' < "$TRANSCRIPT_PATH" 2>/dev/null \\
    | jq -Rr --argjson titleMaxChars "$TITLE_MAX_CHARS" '
        (try fromjson catch null)
        | select(
            type == "object"
            and .type == "ai-title"
            and (.aiTitle | type) == "string"
            and (.aiTitle | length) > 0
          )
        | .aiTitle
        | ${SESSION_TITLE_JQ_FILTER}
      ' 2>/dev/null \\
    | tail -n 1 \\
    || true
}

# Codex appends title updates to its shared index. Keep only the last valid title for this hook's
# exact session ID. The compact lookup object is the first line on stdin, so the hook ID stays out
# of argv and pretty-printed hook input cannot shift the boundary with the index lines.
# In 30 runs per configuration on macOS with synthetic indexes, enabling title lookup increased
# median helper runtime from 11.2 to 16.9 ms for 402 rows (54.6 KB) and from 11.5 to 83.0 ms for
# 40,200 rows (5.54 MB).
read_codex_session_title() {
  CODEX_ROOT="\${CODEX_HOME:-\${HOME:+$HOME/.codex}}"
  [ -n "$CODEX_ROOT" ] || return 0
  SESSION_INDEX="$CODEX_ROOT/session_index.jsonl"
  [ -f "$SESSION_INDEX" ] && [ -r "$SESSION_INDEX" ] || return 0

  LOOKUP="$(
    printf '%s' "$HOOK_INPUT" | jq -Rsc '
      try (fromjson | .session_id | select(type == "string" and length > 0) | {session_id: .})
    ' 2>/dev/null
  )" || return 0
  [ -n "$LOOKUP" ] || return 0

  { printf '%s\\n' "$LOOKUP"; cat 2>/dev/null < "$SESSION_INDEX"; } \\
    | jq -nRr --argjson titleMaxChars "$TITLE_MAX_CHARS" '
        (input | fromjson | .session_id) as $id
        | reduce (
            inputs
            | (try fromjson catch null)
            | select(type == "object" and .id == $id)
            | .thread_name
            | select(type == "string" and length > 0)
          ) as $title (null; $title)
        | strings
        | ${SESSION_TITLE_JQ_FILTER}
      ' 2>/dev/null \\
    || true
}

# Each agent keeps its title in its own storage; agents without a supported source print nothing.
read_session_title() {
  case "$AGENT" in
    claude) read_claude_session_title ;;
    codex) read_codex_session_title ;;
    *) ;;
  esac
}

SESSION_TITLE="$(read_session_title || true)"

# $1 is "true" to include the submitted prompt, "false" to leave it out for the first degradation
# step. The session title and hook JSON share stdin (-Rs reads it as one raw string) so neither
# appears in argv: the first line is the title, which cannot contain a line feed after
# read_session_title, and everything after it is the hook JSON verbatim.
build_payload() {
  printf '%s\\n%s' "$SESSION_TITLE" "$HOOK_INPUT" | jq -Rsc \\
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

      def hook_tool_call($h):
        if (($h.toolCall // null) | type) == "object" then $h.toolCall else null end;

      def hook_tool_name($h):
        $h.tool_name // $h.toolName // (hook_tool_call($h) | .name) // "";

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
        | ($h.tool_input // (hook_tool_call($h) | .args) // null) as $tool_input
        | if ($tool_input | type) == "object"
          then (
            apply_patch_target($tool; $tool_input) //
            $tool_input.file_path //
            $tool_input.Path //
            if $tool == "apply_patch" then null else ($tool_input.command // $tool_input.CommandLine) end //
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
      # The C1 range (U+0080-U+009F) is scrubbed for a different reason: jq emits it unescaped, and
      # xterm treats U+009C (ST) as an OSC terminator, which would end the OSC 777 sequence early and
      # spill the rest of the JSON into the terminal.
      #
      # Line feeds are the exception, kept because prompts are routinely written as lists or
      # paragraphs and that structure is worth showing. They cost nothing here: JSON has a short
      # escape for them, so a newline is two bytes rather than six, and the character limit still
      # bounds the total. Carriage returns are dropped rather than turned into line feeds, so CRLF
      # input yields one break; mapping them would produce two, since this walks code points
      # individually and cannot see the pair.
      def scrub_control_chars:
        explode
        | map(
            if . == 10 then .
            elif . == 13 then empty
            elif . < 32 or (. >= 127 and . <= 159) then 32
            else .
            end
          )
        | implode;

      # Restricted to prompt-submitting events on purpose. Reading any "prompt"-shaped key wherever
      # one appears would let subagent instructions or tool arguments surface in the UI as if the
      # user had typed them. Antigravity PreInvocation events are further restricted to the
      # dedicated lastUserInput metadata field. PreInvocation fires before every model call in a
      # turn and the hook cannot tell the first one apart, so the prompt is re-sent each time and
      # PaneInfoTracker deduplicates it; PostToolUse/Stop copies of lastUserInput are ignored
      # because they would only repeat what the preceding PreInvocation already delivered.
      def raw_submitted_prompt($h):
        if $event == "${AGENT_USER_PROMPT_SUBMIT_EVENT}"
        then ($h.prompt // $h.user_prompt // $h.userPrompt // null)
        elif $event == "${AGENT_PRE_INVOCATION_EVENT}"
        then ($h.lastUserInput // null)
        else null
        end;

      def submitted_prompt($h):
        if $withPrompt
        then (
          (raw_submitted_prompt($h)) as $p
          | if ($p | type) == "string"
            then ($p | scrub_control_chars | .[0:$promptMaxChars])
            else null
            end
        )
        else null
        end;

      split("\\n") as $lines
      | ($lines[0]) as $session_title
      | ($lines[1:] | join("\\n"))
      | ((try fromjson catch {}) | if type == "object" then . else {} end) as $in
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
        + string_field("toolName"; hook_tool_name($in))
        + string_field("activityLabel"; built_activity_label($in))
        + string_field("sessionTitle"; $session_title)
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
      | jq -c 'with_entries(
          if .key == "userPrompt" or .key == "sessionTitle"
          then .value = "[redacted]"
          else .
          end
        )' \\
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
            "command": "$HOME/.config/evermore/evermore-agent-status.sh claude running ${AGENT_USER_PROMPT_SUBMIT_EVENT} terminalSequence"
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
            "command": "$HOME/.config/evermore/evermore-agent-status.sh codex running ${AGENT_USER_PROMPT_SUBMIT_EVENT} tty",
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
        "command": "$HOME/.config/evermore/evermore-agent-status.sh antigravity running ${AGENT_PRE_INVOCATION_EVENT} tty"
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
