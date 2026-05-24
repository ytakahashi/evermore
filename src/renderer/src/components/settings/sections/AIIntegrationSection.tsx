import { useState } from 'react';
import {
  ANTIGRAVITY_CLI_HOOK_SNIPPET,
  CLAUDE_CODE_HOOK_SNIPPET,
  CODEX_CLI_HOOK_SNIPPET,
  EVERMORE_AGENT_STATUS_HELPER_SCRIPT,
} from '../../../../../shared/ai-integration/snippets';
import { CopyableSnippet, type CopyableSnippetDefinition } from '../CopyableSnippet';

type AgentSnippetId = 'claude' | 'codex' | 'antigravity';

interface AgentSnippet {
  id: AgentSnippetId;
  label: string;
  notes: readonly string[];
  snippet: CopyableSnippetDefinition;
}

const HELPER_SNIPPET: CopyableSnippetDefinition = {
  id: 'evermore-agent-status-helper',
  title: 'Evermore agent status helper',
  target: '~/.config/evermore/evermore-agent-status.sh',
  language: 'sh',
  description: (
    <>
      Shared hook helper that emits OSC 777 agent status events for Evermore. Save it here first
      (for example,{' '}
      <code className="rounded bg-raised px-1 py-0.5 font-mono">
        {'$EDITOR "$HOME/.config/evermore/evermore-agent-status.sh"'}
      </code>
      ), then make it executable with{' '}
      <code className="rounded bg-raised px-1 py-0.5 font-mono">
        {'chmod +x "$HOME/.config/evermore/evermore-agent-status.sh"'}
      </code>
      .
    </>
  ),
  content: EVERMORE_AGENT_STATUS_HELPER_SCRIPT,
};

const AGENT_SNIPPETS: readonly [AgentSnippet, ...AgentSnippet[]] = [
  {
    id: 'claude',
    label: 'Claude Code',
    notes: [
      'Paste or merge this into ~/.claude/settings.json.',
      'Claude Code uses terminalSequence so the hook result asks Claude to emit the OSC sequence.',
      'After setup, the sidebar shows Claude as running while a turn is active, awaiting input when approval is needed, and ready when the turn completes.',
    ],
    snippet: {
      id: 'claude-code-hooks',
      title: 'Claude Code hooks',
      target: '~/.claude/settings.json',
      language: 'json',
      description:
        'Updates the sidebar as Claude starts running, waits for approval, resumes after tool use, and finishes a turn.',
      content: CLAUDE_CODE_HOOK_SNIPPET,
    },
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    notes: [
      'Paste or merge this into ~/.codex/hooks.json.',
      'Codex CLI can write the OSC sequence directly to /dev/tty from the hook process.',
      'When Codex asks to trust the configured hooks, approve them so Evermore can receive status updates.',
      'After setup, the sidebar shows Codex as running while a turn is active, awaiting input when approval is needed, and ready when the turn completes.',
    ],
    snippet: {
      id: 'codex-cli-hooks',
      title: 'Codex CLI hooks',
      target: '~/.codex/hooks.json',
      language: 'json',
      description:
        'Updates the sidebar as Codex starts running, waits for approval, resumes after tool use, and finishes a turn.',
      content: CODEX_CLI_HOOK_SNIPPET,
    },
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    notes: [
      'Paste or merge this into ~/.gemini/config/hooks.json.',
      'Antigravity CLI can write the OSC sequence directly to /dev/tty from the hook process.',
      'After setup, the sidebar shows Antigravity as running while a turn is active and ready when the turn completes.',
      'Approval prompts may not change the sidebar to awaiting input yet because Antigravity does not expose a reliable approval hook.',
    ],
    snippet: {
      id: 'antigravity-cli-hooks',
      title: 'Antigravity CLI hooks',
      target: '~/.gemini/config/hooks.json',
      language: 'json',
      description:
        'Updates the sidebar as Antigravity starts running and finishes a turn. Awaiting-input is not enabled for this CLI yet.',
      content: ANTIGRAVITY_CLI_HOOK_SNIPPET,
    },
  },
];

/**
 * Renders manual setup snippets for AI agent hooks that report status through Evermore OSC 777.
 */
export function AIIntegrationSection(): React.JSX.Element {
  const [activeAgentId, setActiveAgentId] = useState<AgentSnippetId>('claude');
  const activeAgent =
    AGENT_SNIPPETS.find((agent) => agent.id === activeAgentId) ?? AGENT_SNIPPETS[0];

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">AI Integration</h2>
        <p className="mt-1 text-sm text-muted">
          Manual hook snippets for showing AI agent running and waiting states in the sidebar.
        </p>
      </header>

      <section className="border-b border-border-subtle py-4">
        <h3 className="text-sm font-medium">Prerequisites</h3>
        <div className="mt-2 grid gap-2 text-xs leading-5 text-muted">
          <p>
            Requires <code className="rounded bg-raised px-1 py-0.5 font-mono">jq</code>. On macOS:{' '}
            <code className="rounded bg-raised px-1 py-0.5 font-mono">brew install jq</code>
          </p>
          <p>
            Evermore does not write these files automatically. Copy the helper script first, then
            paste or merge the hook JSON for each AI CLI you use.
          </p>
        </div>
      </section>

      <section>
        <CopyableSnippet snippet={HELPER_SNIPPET} />
      </section>

      <section className="py-4">
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="AI hook snippets">
          {AGENT_SNIPPETS.map((agent) => {
            const isActive = agent.id === activeAgentId;
            return (
              <button
                aria-selected={isActive}
                className={
                  isActive
                    ? 'rounded border border-brand bg-raised px-2 py-1 text-sm text-foreground'
                    : 'rounded border border-border px-2 py-1 text-sm text-muted hover:bg-raised hover:text-foreground'
                }
                key={agent.id}
                onClick={() => {
                  setActiveAgentId(agent.id);
                }}
                role="tab"
                type="button"
              >
                {agent.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel">
          <ul className="mb-1 grid gap-1 text-xs leading-5 text-muted">
            {activeAgent.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <CopyableSnippet snippet={activeAgent.snippet} />
        </div>
      </section>

      <section className="border-t border-border-subtle py-4">
        <h3 className="text-sm font-medium">Debug logging</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
          Set <code className="rounded bg-raised px-1 py-0.5 font-mono">EVERMORE_HOOK_DEBUG=1</code>{' '}
          before launching the AI CLI to log hook payloads. Override the default{' '}
          <code className="rounded bg-raised px-1 py-0.5 font-mono">
            /tmp/evermore-agent-hook.log
          </code>{' '}
          path with{' '}
          <code className="rounded bg-raised px-1 py-0.5 font-mono">EVERMORE_HOOK_LOG</code>.
        </p>
      </section>
    </div>
  );
}
