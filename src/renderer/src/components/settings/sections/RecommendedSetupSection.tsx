import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface SetupSnippet {
  content: string;
  description: string;
  id: string;
  language: string;
  target: string;
  title: string;
}

type CopyState = 'idle' | 'copied' | 'error';

// The zsh snippet walks PWD byte-by-byte so non-ASCII paths are encoded as UTF-8
// percent bytes for `decodeURIComponent`, not as Unicode codepoints.
const SETUP_SNIPPETS: readonly SetupSnippet[] = [
  {
    id: 'osc7',
    title: 'OSC 7 cwd tracking',
    target: '~/.zshrc',
    language: 'sh',
    description:
      'Emits the current directory when your shell starts and whenever it changes, so Evermore can keep pane cwd metadata in sync. Targets zsh; bash/fish users need an equivalent PROMPT_COMMAND / pwd hook that prints the same OSC 7 sequence.',
    content: `function _evermore_osc7() {
  emulate -L zsh
  setopt no_multibyte
  local i ch out=""
  for (( i = 1; i <= \${#PWD}; i++ )); do
    ch=$PWD[i]
    case $ch in
      [a-zA-Z0-9/._~-]) out+=$ch ;;
      *) out+=$(printf '%%%02X' "'$ch") ;;
    esac
  done
  printf '\\e]7;file://%s%s\\e\\\\' "$HOST" "$out"
}

autoload -Uz add-zsh-hook
add-zsh-hook chpwd _evermore_osc7
[[ -o interactive ]] && _evermore_osc7`,
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
