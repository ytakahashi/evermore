import { useEffect, useRef, type RefObject } from 'react';
import { SidebarBottomNav } from '../sidebar/SidebarBottomNav';
import { ConnectionsView } from '../sidebar/ConnectionsView';
import { WorkspacesView } from '../sidebar/WorkspacesView';
import { useUiStore } from '../../stores/uiStore';

export function Sidebar(): React.JSX.Element | null {
  const sidebarView = useUiStore((state) => state.sidebarView);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const asideRef = useRef<HTMLElement | null>(null);

  if (!sidebarOpen) {
    return null;
  }

  return (
    <aside
      ref={asideRef}
      className="relative flex flex-shrink-0 flex-col border-r border-border bg-panel"
      style={{ width: `${sidebarWidth}px` }}
    >
      <div className="flex-1 overflow-y-auto p-2">
        {sidebarView === 'workspaces' ? <WorkspacesView /> : <ConnectionsView />}
      </div>
      <SidebarBottomNav />
      <SidebarResizeHandle asideRef={asideRef} />
    </aside>
  );
}

interface SidebarResizeHandleProps {
  asideRef: RefObject<HTMLElement | null>;
}

function SidebarResizeHandle({ asideRef }: SidebarResizeHandleProps): React.JSX.Element {
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  const dragControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      dragControllerRef.current?.abort();
    };
  }, []);

  return (
    <div
      aria-label="Resize sidebar"
      className="absolute right-[-2px] top-0 z-10 h-full w-1 cursor-col-resize bg-transparent hover:bg-border-pane-active"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={(event) => {
        event.preventDefault();
        const asideRect = asideRef.current?.getBoundingClientRect();
        if (!asideRect) {
          return;
        }

        dragControllerRef.current?.abort();
        const controller = new AbortController();
        dragControllerRef.current = controller;

        const handleMouseMove = (moveEvent: MouseEvent): void => {
          setSidebarWidth(moveEvent.clientX - asideRect.left);
        };

        const handleMouseUp = (): void => {
          controller.abort();
          if (dragControllerRef.current === controller) {
            dragControllerRef.current = null;
          }
        };

        const { signal } = controller;
        window.addEventListener('mousemove', handleMouseMove, { signal });
        window.addEventListener('mouseup', handleMouseUp, { signal });
      }}
    />
  );
}
