import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export interface CopyableSnippetDefinition {
  content: string;
  description: ReactNode;
  id: string;
  language: string;
  target: string;
  title: string;
}

type CopyState = 'idle' | 'copied' | 'error';

interface CopyableSnippetProps {
  snippet: CopyableSnippetDefinition;
}

/**
 * Renders a copyable configuration snippet with local clipboard success/error state.
 */
export function CopyableSnippet({ snippet }: CopyableSnippetProps): React.JSX.Element {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const copySnippet = async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyState('error');
      return;
    }

    try {
      await navigator.clipboard.writeText(snippet.content);
      setCopyState('copied');
      globalThis.setTimeout(() => {
        setCopyState('idle');
      }, 1500);
    } catch (_error: unknown) {
      // Clipboard failures are permission/environment dependent; the visible error state is enough.
      setCopyState('error');
    }
  };

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
              void copySnippet();
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
