import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from '../../../../../shared/shell-integration/zsh-snippet';

interface SetupSnippet {
  content: string;
  description: string;
  id: string;
  language: string;
  target: string;
  title: string;
}

type CopyState = 'idle' | 'copied' | 'error';

const SETUP_SNIPPETS: readonly SetupSnippet[] = [
  {
    id: 'evermore-zsh',
    title: 'Shell integration (zsh)',
    target: '~/.zshrc',
    language: 'sh',
    description:
      'Emits OSC 7 (cwd), OSC 133 (prompt and command lifecycle), and OSC 633;E (exact command line) so the Evermore sidebar reflects shell-level state instead of process-table heuristics. zsh only — paste this whole block at the end of ~/.zshrc. The snippet is idempotent and becomes a no-op under another terminal emulator (VS Code, Warp, WezTerm, iTerm, Ghostty) that already provides shell integration.',
    content: EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
  },
  {
    id: 'ssh-config',
    title: 'SSH tunnel reliability',
    target: '~/.ssh/config',
    language: 'sshconfig',
    description:
      'Makes dropped connections and forward binding failures surface quickly in Evermore tunnel status.',
    content: `Host *
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes`,
  },
];

interface CopyableSnippetProps {
  copyState: CopyState;
  onCopy: (snippet: SetupSnippet) => void;
  snippet: SetupSnippet;
}

function CopyableSnippet({ copyState, onCopy, snippet }: CopyableSnippetProps): React.JSX.Element {
  return (
    <article className="border-b border-border-subtle py-4 last:border-b-0">
      <div className="mb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{snippet.title}</h3>
            <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-muted">
              {snippet.target}
            </code>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{snippet.description}</p>
        </div>
      </div>
      <div className="rounded bg-raised">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
          <span className="font-mono text-xs text-muted">{snippet.language}</span>
          <button
            aria-label={`Copy ${snippet.title} snippet`}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs text-foreground transition-colors hover:border-brand hover:bg-panel hover:text-brand disabled:opacity-50"
            onClick={() => {
              onCopy(snippet);
            }}
            title={`Copy ${snippet.title} snippet`}
            type="button"
          >
            {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copyState === 'copied' ? 'Copied' : 'Copy snippet'}</span>
          </button>
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-foreground">
          <code>{snippet.content}</code>
        </pre>
      </div>
      {copyState === 'error' ? <div className="mt-2 text-xs text-danger">Copy failed</div> : null}
    </article>
  );
}

/**
 * Renders optional shell and SSH snippets that users can copy into their local configuration.
 */
export function RecommendedSetupSection(): React.JSX.Element {
  const [copyStates, setCopyStates] = useState<Record<string, CopyState>>({});

  const copySnippet = async (snippet: SetupSnippet): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyStates((current) => ({ ...current, [snippet.id]: 'error' }));
      return;
    }

    try {
      await navigator.clipboard.writeText(snippet.content);
      setCopyStates((current) => ({ ...current, [snippet.id]: 'copied' }));
      globalThis.setTimeout(() => {
        setCopyStates((current) => ({ ...current, [snippet.id]: 'idle' }));
      }, 1500);
    } catch (_error: unknown) {
      // Clipboard failures are permission/environment dependent; the visible error state is enough.
      setCopyStates((current) => ({ ...current, [snippet.id]: 'error' }));
    }
  };

  return (
    <div>
      <header className="mb-2">
        <h2 className="text-base font-semibold">Recommended setup</h2>
        <p className="mt-1 text-sm text-muted">
          Optional local shell and SSH snippets that improve Evermore terminal and tunnel behavior.
        </p>
      </header>

      <div>
        {SETUP_SNIPPETS.map((snippet) => (
          <CopyableSnippet
            copyState={copyStates[snippet.id] ?? 'idle'}
            key={snippet.id}
            onCopy={(selectedSnippet) => {
              void copySnippet(selectedSnippet);
            }}
            snippet={snippet}
          />
        ))}
      </div>
    </div>
  );
}
