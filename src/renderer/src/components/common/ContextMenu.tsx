import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { isSelectableItem, type ContextMenuItem } from './contextMenuItems';

// Re-export the item type so existing consumers can keep importing it alongside the component. The
// runtime helpers (`hasActionableItem`) intentionally live only in `./contextMenuItems` so this
// component file stays free of value exports that would break React Fast Refresh.
export type { ContextMenuItem } from './contextMenuItems';

interface ContextMenuProps {
  /** Viewport coordinates (client px) of the originating right-click. */
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
}

const VIEWPORT_MARGIN_PX = 4;

/**
 * A lightweight right-click menu rendered into `document.body` via a portal.
 *
 * The portal is required because trigger containers such as the tab bar use `overflow-hidden`; an
 * in-flow menu would be clipped. The menu closes on outside pointer-down, Escape, scroll, window
 * blur, or after selecting an action, and keeps focus inside itself so keyboard users can navigate
 * with the arrow keys.
 */
export function ContextMenu({ position, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Start at the raw click point, then nudge on-screen once we can measure the menu.
  const [resolvedPosition, setResolvedPosition] = useState(position);
  const [activeIndex, setActiveIndex] = useState<number>(() =>
    items.findIndex((item) => isSelectableItem(item)),
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }

    // Flip the menu back inside the viewport when the click lands near the right / bottom edge.
    const { width, height } = menu.getBoundingClientRect();
    const maxX = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const maxY = window.innerHeight - height - VIEWPORT_MARGIN_PX;
    setResolvedPosition({
      x: Math.max(VIEWPORT_MARGIN_PX, Math.min(position.x, maxX)),
      y: Math.max(VIEWPORT_MARGIN_PX, Math.min(position.y, maxY)),
    });
  }, [position]);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // A scroll or window blur shifts the page out from under the anchored menu, so dismiss instead
    // of leaving it floating at a stale position.
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('blur', onClose);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const moveActiveIndex = (delta: number): void => {
    const count = items.length;
    if (count === 0) {
      return;
    }

    let nextIndex = activeIndex;
    for (let step = 0; step < count; step += 1) {
      nextIndex = (nextIndex + delta + count) % count;
      if (isSelectableItem(items[nextIndex])) {
        setActiveIndex(nextIndex);
        return;
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveActiveIndex(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActiveIndex(-1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[activeIndex];
        if (item && isSelectableItem(item)) {
          item.onSelect();
          onClose();
        }
        break;
      }
      default:
        break;
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      tabIndex={-1}
      role="menu"
      aria-orientation="vertical"
      className="fixed z-50 min-w-44 overflow-hidden rounded-md border border-border bg-panel py-1 text-xs shadow-lg outline-none"
      style={{ left: resolvedPosition.x, top: resolvedPosition.y }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return (
            <div key={`separator-${index}`} className="my-1 h-px bg-border" role="separator" />
          );
        }

        if (item.type === 'label') {
          return (
            <div
              key={`label-${index}`}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-subtle"
            >
              {item.label}
            </div>
          );
        }

        const isActive = index === activeIndex;
        return (
          <button
            key={item.id}
            role="menuitem"
            type="button"
            disabled={item.disabled}
            title={item.title}
            className={`flex w-full items-center px-3 py-1.5 text-left text-foreground disabled:cursor-default disabled:text-subtle/50 ${
              isActive && !item.disabled ? 'bg-raised' : 'hover:bg-raised'
            }`}
            onMouseEnter={() => {
              if (!item.disabled) {
                setActiveIndex(index);
              }
            }}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
