import { EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET } from '../../../../../shared/shell-integration/zsh-snippet';
import { CopyableSnippet, type CopyableSnippetDefinition } from '../CopyableSnippet';

const SETUP_SNIPPETS: readonly CopyableSnippetDefinition[] = [
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
  {
    id: 'evermore-zsh',
    title: 'Shell integration (zsh)',
    target: '~/.zshrc',
    language: 'sh',
    description:
      'Emits OSC 7 (cwd), OSC 133 (prompt and command lifecycle), and OSC 633;E (exact command line) so the Evermore sidebar reflects shell-level state instead of process-table heuristics. With Advanced features → Automatic shell integration (zsh) enabled (the default), Evermore already injects this snippet into new panes — pasting it manually is not required. The snippet is still useful if you disable auto-injection, or if you want shell integration in subshells started inside an Evermore PTY (auto-injection is intentionally not inherited by subshells). The snippet is idempotent and becomes a no-op under another terminal emulator (VS Code, Warp, WezTerm, iTerm, Ghostty) that already provides shell integration.',
    content: EVERMORE_ZSH_SHELL_INTEGRATION_SNIPPET,
  },
];

/**
 * Renders optional shell and SSH snippets that users can copy into their local configuration.
 */
export function RecommendedSetupSection(): React.JSX.Element {
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
          <CopyableSnippet key={snippet.id} snippet={snippet} />
        ))}
      </div>
    </div>
  );
}
