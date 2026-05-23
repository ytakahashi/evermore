import type { PaneKnownAgent } from '../../../../shared/types';

interface SparklesIconProps {
  /**
   * Known agent identifier that drives icon color. When omitted (unknown agent) the icon falls
   * back to a high-contrast solid color so it is still visible against the sidebar background.
   */
  agent?: PaneKnownAgent;
  /**
   * Per-pane index used to suffix the `<linearGradient>` id. The same icon can mount multiple
   * times in the sidebar, and SVG gradient ids are document-global; without a unique suffix the
   * second-mounted gradient would inherit the first one's stops once React reuses the DOM.
   */
  paneIndex: number;
  className?: string;
  size?: number;
}

const STROKE_BY_AGENT: Record<Exclude<PaneKnownAgent, 'codex' | 'antigravity'>, string> = {
  claude: '#DE7356',
  cursor: '#72716d',
};

const UNKNOWN_AGENT_STROKE = '#ffffff';

/**
 * Sparkles icon rendered with per-agent stroke color or gradient.
 *
 * The Sparkles glyph is taken from lucide and inlined so codex / antigravity can use a vertical
 * linear gradient as the stroke. Solid-color agents reuse the same SVG with a flat stroke; both
 * paths share one component so the sidebar mapping does not have to special-case agent shapes.
 */
export function SparklesIcon({
  agent,
  paneIndex,
  className = '',
  size = 13,
}: SparklesIconProps): React.JSX.Element {
  const usesGradient = agent === 'codex' || agent === 'antigravity';
  const gradientId = `sparkles-${agent ?? 'unknown'}-gradient-${paneIndex}`;

  let stroke = UNKNOWN_AGENT_STROKE;
  if (usesGradient) {
    stroke = `url(#${gradientId})`;
  } else if (agent === 'claude' || agent === 'cursor') {
    stroke = STROKE_BY_AGENT[agent];
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {usesGradient && (
        <defs>
          {agent === 'antigravity' ? (
            <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#fc413d" />
              <stop offset="20%" stopColor="#fbbc04" />
              <stop offset="35%" stopColor="#00b95c" />
              <stop offset="50%" stopColor="#3186ff" />
              <stop offset="100%" stopColor="#3186ff" />
            </linearGradient>
          ) : (
            <linearGradient id={gradientId} x1="0%" x2="0%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#b1a7ff" />
              <stop offset="50%" stopColor="#7a9dff" />
              <stop offset="100%" stopColor="#3941ff" />
            </linearGradient>
          )}
        </defs>
      )}
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z" />
      <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5.5Z" />
      <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1.5Z" />
    </svg>
  );
}
