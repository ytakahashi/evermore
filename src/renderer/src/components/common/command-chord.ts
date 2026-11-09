/** Returns whether only Command is held, outside IME composition. The caller checks the key. */
export function isExactCommandChord(event: KeyboardEvent): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    // WebKit can report `isComposing: false` for the key that ends composition.
    !event.isComposing &&
    event.keyCode !== 229
  );
}
