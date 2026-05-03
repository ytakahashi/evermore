import { useEffect, useRef } from 'react';

/**
 * Observes layout changes without forcing callers to recreate the browser observer on every render.
 *
 * xterm's fit addon needs the latest resize callback, but reconnecting `ResizeObserver` frequently
 * is unnecessary work and can miss fast layout changes during pane operations.
 */
export function useResizeObserver<T extends Element>(
  targetRef: React.RefObject<T | null>,
  onResize: () => void,
): void {
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    const element = targetRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      onResizeRef.current();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [targetRef]);
}
