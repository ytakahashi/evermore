/** Renderer-owned terminal resources; the React-managed home container never moves. */
export interface TerminalHostHandle {
  element: HTMLElement;
  home: HTMLElement;
  /** Fits the existing xterm and resizes its existing PTY to the current parent. */
  fit: () => void;
}

interface Registration {
  handle: TerminalHostHandle;
}

/** Registry API shared across terminal owners and display surfaces. */
export interface TerminalHostRegistry {
  subscribe: (listener: () => void) => () => void;
  getHandle: (paneId: string) => TerminalHostHandle | undefined;
  getBorrowedHost: () => HTMLElement | undefined;
  register: (paneId: string, handle: TerminalHostHandle) => () => void;
  borrow: (paneId: string, host: HTMLElement) => (() => void) | null;
}

/** Creates an isolated registry for terminal ownership and one temporary display host. */
export function createTerminalHostRegistry(): TerminalHostRegistry {
  const registrations = new Map<string, Registration>();
  const listeners = new Set<() => void>();
  let borrowed: { registration: Registration; host: HTMLElement } | null = null;

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    /** Subscribes to registrations changing, including late terminal initialization. */
    subscribe(this: void, listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Returns a stable snapshot until this pane's terminal is registered or removed. */
    getHandle(paneId: string): TerminalHostHandle | undefined {
      return registrations.get(paneId)?.handle;
    },
    /** Returns the registry's current borrowed host as a stable external-store snapshot. */
    getBorrowedHost(): HTMLElement | undefined {
      return borrowed?.host;
    },
    /** Registers after xterm opens; stale cleanup cannot remove a replacement terminal. */
    register(paneId: string, handle: TerminalHostHandle): () => void {
      const previous = registrations.get(paneId);
      if (previous && borrowed?.registration === previous) borrowed = null;
      const registration = { handle };
      registrations.set(paneId, registration);
      notify();
      return () => {
        if (registrations.get(paneId) !== registration) return;
        registrations.delete(paneId);
        if (borrowed?.registration === registration) borrowed = null;
        notify();
      };
    },
    /** Borrows one xterm root globally; release is idempotent and never resurrects disposed DOM. */
    borrow(paneId: string, host: HTMLElement): (() => void) | null {
      const registration = registrations.get(paneId);
      // Only one alternative detail panel is supported, including across different panes.
      if (!registration || borrowed) return null;
      const lease = { registration, host };
      const { home, element, fit } = registration.handle;
      // The borrowed registration and host change together, including during fit callbacks.
      borrowed = lease;
      try {
        host.appendChild(element);
        fit();
      } catch (error: unknown) {
        // No release function reaches the caller on failure, so roll back the move and unlock.
        if (borrowed === lease) {
          borrowed = null;
          if (home.isConnected) home.appendChild(element);
          notify();
        }
        throw error;
      }
      notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (borrowed !== lease || registrations.get(paneId) !== registration) return;
        borrowed = null;
        try {
          if (home.isConnected) {
            home.appendChild(element);
            // Hidden homes may not fit yet; their existing ResizeObserver refits on reveal.
            fit();
          }
        } finally {
          // Subscribers must observe release even if fitting the returned terminal fails.
          notify();
        }
      };
    },
  };
}

/** Production registry shared by terminal owners and alternative display surfaces. */
export const terminalHostRegistry = createTerminalHostRegistry();
