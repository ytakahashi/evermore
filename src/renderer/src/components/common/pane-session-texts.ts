import { TRUNCATION_MARKER } from '../../../../shared/text/sanitize-agent-text';
import type { PaneRuntimeInfo } from '../../../../shared/types';

/**
 * Session title and prompt a pane row should render, each `undefined` when its row is omitted.
 */
export interface PaneSessionTexts {
  sessionTitle?: string;
  userPrompt?: string;
}

/**
 * Picks the session title and prompt rows to render for a pane.
 *
 * The prompt is dropped when it repeats the title. Codex CLI uses the first message as a
 * provisional session title until generation finishes, so during the first turn both fields carry
 * the same text and showing both would only duplicate it. Returned values are the originals, so
 * each view keeps its own whitespace rendering.
 *
 * Shared by the Agents view and the sidebar so a pane never shows the prompt on one surface and
 * hides it on the other.
 */
export function getPaneSessionTexts(info: PaneRuntimeInfo | undefined): PaneSessionTexts {
  const sessionTitle = info?.sessionTitle || undefined;
  const userPrompt = info?.userPrompt || undefined;

  if (
    sessionTitle !== undefined &&
    userPrompt !== undefined &&
    isTitleDerivedFromPrompt(sessionTitle, userPrompt)
  ) {
    return { sessionTitle };
  }

  return { sessionTitle, userPrompt };
}

/**
 * Compares letters and digits only. Codex renders the first message as plain text before using it
 * as the provisional title (markdown syntax dropped, whitespace collapsed), while the prompt keeps
 * the message as written apart from the tracker's whitespace cleanup.
 *
 * A title ending in `…` was cut short, either by Codex (60 characters in 0.171.0) or by the tracker
 * (`AGENT_SESSION_TITLE_MAX_CHARS`), so it only has to match the start of the prompt. Both cut the
 * text, trim trailing whitespace and append `…`, the same marker the shared sanitizer uses. The
 * prompt limit is larger than either title limit, so the prompt always covers the title's prefix.
 */
function isTitleDerivedFromPrompt(title: string, prompt: string): boolean {
  const isTruncated = title.endsWith(TRUNCATION_MARKER);
  const titleKey = toComparisonKey(isTruncated ? title.slice(0, -TRUNCATION_MARKER.length) : title);
  // A title with no letters or digits gives no evidence that it came from the prompt.
  if (titleKey === '') {
    return false;
  }

  const promptKey = toComparisonKey(prompt);
  return isTruncated ? promptKey.startsWith(titleKey) : promptKey === titleKey;
}

function toComparisonKey(text: string): string {
  return text.replace(/[^\p{L}\p{N}]/gu, '');
}
