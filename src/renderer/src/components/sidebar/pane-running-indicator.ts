import type { PaneRuntimeInfo } from '../../../../shared/types';

/**
 * Visual style for the sidebar's pane running-state dot.
 */
export interface PaneRunningIndicator {
  /** Tailwind class string for the dot element. */
  className: string;
  /** Accessible label exposed via `aria-label`. */
  label: string;
  /** Native tooltip text. */
  title: string;
}

const BASE_DOT_CLASSES = 'mt-1.5 size-1.5 shrink-0 rounded-full';

const INDICATOR_AWAITING_INPUT: PaneRunningIndicator = {
  className: `${BASE_DOT_CLASSES} bg-danger`,
  label: 'awaiting input',
  title: 'Awaiting input',
};

const INDICATOR_WORKING: PaneRunningIndicator = {
  className: `${BASE_DOT_CLASSES} bg-accent animate-pulse`,
  label: 'working',
  title: 'Working',
};

const INDICATOR_RUNNING: PaneRunningIndicator = {
  className: `${BASE_DOT_CLASSES} bg-success`,
  label: 'running',
  title: 'Running',
};

/**
 * Picks the running-state dot for a pane based on the merged runtime info.
 *
 * Priority (highest first):
 * 1. `attention.kind === 'awaiting-input'` or `agent.status === 'awaiting-input'` — red dot
 * 2. `agent.status === 'running'` — blue pulsing dot
 * 3. Any other running state (`agent.status === 'ready'` or non-agent running) — green dot
 *
 * Returns `undefined` for idle panes, in which case the caller should render nothing.
 */
export function getPaneRunningIndicator(
  info: PaneRuntimeInfo | undefined,
): PaneRunningIndicator | undefined {
  if (!info || info.processActivity !== 'running') {
    return undefined;
  }

  if (info.attention?.kind === 'awaiting-input' || info.agent?.status === 'awaiting-input') {
    return INDICATOR_AWAITING_INPUT;
  }

  if (info.agent?.status === 'running') {
    return INDICATOR_WORKING;
  }

  return INDICATOR_RUNNING;
}
