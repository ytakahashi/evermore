/**
 * Shared helpers for the native HTML5 drag-and-drop used to reorder workspace tabs (horizontally in
 * the TabBar) and to reorder / move them (vertically in the sidebar tree).
 *
 * Native DnD does not expose `dataTransfer.getData()` during `dragover` — only the list of `types`
 * is readable until `drop` — so the drag source's ids cannot travel through `dataTransfer` for the
 * hover / index math. They are kept in `useTabDragStore` instead; `dataTransfer` carries only the
 * marker MIME below so `dragover` / `drop` handlers can recognise one of our tab drags (via
 * `dataTransfer.types`) without reading its payload.
 */
export const TAB_DND_MIME = 'application/x-evermore-tab';

/** Layout axis of a tab list: the TabBar is horizontal, the sidebar tree is vertical. */
export type Axis = 'horizontal' | 'vertical';

/** Which side of a hovered tab the drop would land on. */
export type DropEdge = 'before' | 'after';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Returns whether a pointer at `point` is closer to the leading (`'before'`) or trailing (`'after'`)
 * side of `bounds` along `axis`. Kept pure (numbers in, edge out) so the midpoint logic is unit
 * tested without a DOM; callers pass `event.clientX/Y` and `getBoundingClientRect()`.
 */
export function resolveDropEdge(axis: Axis, point: Point, bounds: Bounds): DropEdge {
  if (axis === 'horizontal') {
    const midpoint = (bounds.left + bounds.right) / 2;
    return point.x < midpoint ? 'before' : 'after';
  }

  const midpoint = (bounds.top + bounds.bottom) / 2;
  return point.y < midpoint ? 'before' : 'after';
}

/**
 * Translates a hovered tab's display index and drop edge into the `toIndex` argument of
 * `reorderWorkspaceTab`. That action removes the dragged tab before re-inserting it, so any target
 * slot that sits after the dragged tab shifts left by one once the gap closes. Dropping a tab onto
 * its own slot resolves back to its current index, which `reorderWorkspaceTab` treats as a no-op.
 */
export function toReorderIndex(fromIndex: number, displayIndex: number, edge: DropEdge): number {
  const insertBefore = edge === 'after' ? displayIndex + 1 : displayIndex;
  return insertBefore > fromIndex ? insertBefore - 1 : insertBefore;
}
