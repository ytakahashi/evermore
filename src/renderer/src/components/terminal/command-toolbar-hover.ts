import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';

export interface TerminalCommandToolbarHost extends IDisposable {
  /** Replaces the renderer-owned DOM host without changing entry precedence. */
  setElement: (element: HTMLElement | null) => void;
}

interface Host {
  marker: IMarker;
  element: HTMLElement | null;
  changed: (hovered: boolean, representative: boolean) => void;
  hovered: boolean;
  representative: boolean;
}

/** Tracks pointer hover without putting an interactive overlay over terminal text. */
export class TerminalCommandToolbarHover implements IDisposable {
  private readonly hosts = new Set<Host>();
  private readonly subscriptions: IDisposable[];
  private readonly root: HTMLElement | undefined;
  private pointer: { x: number; y: number } | null = null;
  private dragging = false;
  private frame: number | null = null;
  private disposed = false;

  public constructor(private readonly terminal: Terminal) {
    this.root = terminal.element;
    this.root?.addEventListener('pointermove', this.move);
    this.root?.addEventListener('pointerleave', this.leave);
    this.root?.addEventListener('pointerdown', this.down);
    this.root?.ownerDocument.addEventListener('pointerup', this.up);
    this.subscriptions = [
      terminal.onScroll(this.refresh),
      terminal.onResize(this.refresh),
      terminal.onRender(this.refresh),
      terminal.buffer.onBufferChange(this.refresh),
    ];
  }

  /** Registers in completion order; the latest command represents a shared physical start row. */
  public register(marker: IMarker, changed: Host['changed']): TerminalCommandToolbarHost {
    const host: Host = { marker, element: null, changed, hovered: false, representative: true };
    if (!this.disposed) {
      this.hosts.add(host);
    }
    return {
      setElement: (element) => {
        if (!this.hosts.has(host)) {
          return;
        }
        if (element === null && host.element === null) {
          return;
        }
        host.element = element;
        this.refresh();
      },
      dispose: () => {
        this.hosts.delete(host);
        this.refresh();
      },
    };
  }

  /** Coalesces scroll, renderer, and pointer notifications into one geometry pass per frame. */
  public readonly refresh = (): void => {
    if (this.disposed || this.frame !== null || this.hosts.size === 0) {
      return;
    }
    this.frame = globalThis.requestAnimationFrame(() => {
      this.frame = null;
      this.update();
    });
  };

  /** Removes all DOM/terminal subscriptions and pending frame work without owning any decorations. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.frame !== null) {
      globalThis.cancelAnimationFrame(this.frame);
    }
    this.frame = null;
    this.root?.removeEventListener('pointermove', this.move);
    this.root?.removeEventListener('pointerleave', this.leave);
    this.root?.removeEventListener('pointerdown', this.down);
    this.root?.ownerDocument.removeEventListener('pointerup', this.up);
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.hosts.clear();
  }

  private readonly move = (event: PointerEvent): void => {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.dragging =
      event.buttons !== 0 &&
      (!(event.target instanceof Element) ||
        !event.target.closest('.evermore-command-copy-toolbar'));
    this.refresh();
  };
  private readonly leave = (): void => {
    this.pointer = null;
    this.dragging = false;
    this.refresh();
  };
  private readonly down = (event: PointerEvent): void => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('.evermore-command-copy-toolbar')
    ) {
      this.dragging = true;
      this.refresh();
    }
  };
  private readonly up = (): void => {
    this.dragging = false;
    this.refresh();
  };

  private update(): void {
    const representatives = new Map<number, Host>();
    // Precedence follows completion, not DOM creation order (which changes on resize or scrolling).
    for (const host of this.hosts) {
      if (!host.marker.isDisposed) {
        representatives.set(host.marker.line, host);
      }
    }
    for (const host of this.hosts) {
      const representative = representatives.get(host.marker.line) === host;
      const element = host.element;
      let hovered = false;
      if (
        representative &&
        this.pointer &&
        !this.dragging &&
        this.terminal.buffer.active.type === 'normal' &&
        element?.isConnected &&
        element.style.display !== 'none'
      ) {
        const rect = element.getBoundingClientRect();
        hovered =
          rect.width > 0 &&
          rect.height > 0 &&
          this.pointer.x >= rect.left &&
          this.pointer.x < rect.right &&
          this.pointer.y >= rect.top &&
          this.pointer.y < rect.bottom;
      }
      if (hovered !== host.hovered || representative !== host.representative) {
        host.hovered = hovered;
        host.representative = representative;
        host.changed(hovered, representative);
      }
    }
  }
}
