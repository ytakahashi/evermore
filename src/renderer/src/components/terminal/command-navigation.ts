/** Finds the nearest strictly preceding or following command without relying on entry order. */
export function findAdjacentCommand(
  entries: readonly { id: string; startLine: number }[],
  anchorLine: number,
  direction: 'previous' | 'next',
): string | null {
  let adjacent: { id: string; startLine: number } | null = null;
  for (const entry of entries) {
    const isCandidate =
      direction === 'previous' ? entry.startLine < anchorLine : entry.startLine > anchorLine;
    const isCloser =
      adjacent === null ||
      (direction === 'previous'
        ? entry.startLine > adjacent.startLine
        : entry.startLine < adjacent.startLine);
    if (isCandidate && isCloser) {
      adjacent = entry;
    }
  }
  return adjacent?.id ?? null;
}
