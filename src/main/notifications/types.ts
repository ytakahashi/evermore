import type { BrowserWindow, NotificationConstructorOptions } from 'electron';
import type { Logger } from '../logging/logger';

/**
 * Subset of the Electron `Notification` surface that {@link NotificationService} consumes.
 *
 * Kept structural so unit tests can substitute a fake implementation without spinning up Electron
 * or a real `BrowserWindow`. The production wiring binds these to Electron's `Notification` class.
 */
export interface NotificationLike {
  show: () => void;
  close: () => void;
  on: (event: 'click' | 'close' | 'failed', listener: () => void) => NotificationLike;
}

/**
 * Constructor options for {@link NotificationService}.
 *
 * Every Electron-facing capability is exposed as an injectable factory so the service can be
 * unit-tested without `Notification.isSupported()`, real `Notification` instances, or a real
 * `BrowserWindow`.
 */
export interface NotificationServiceOptions {
  /** Returns the current `BrowserWindow`. Used by the click handler to focus the app. */
  getWindow: () => BrowserWindow | null;
  /** Returns whether the host can display notifications. Defaults to Electron `Notification.isSupported()`. */
  isSupported?: () => boolean;
  /**
   * Factory that produces a notification from Electron's constructor options. Defaults to
   * `new Notification(...)` from `electron`. Tests pass a stub that records calls and returns a
   * {@link NotificationLike}.
   */
  createNotification?: (options: NotificationConstructorOptions) => NotificationLike;
  /** Clock injection point. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Minimum gap, in milliseconds, between two notifications carrying the same `id`. Notifications
   * shown within the gap are suppressed. Defaults to 10_000ms (10s).
   */
  cooldownMs?: number;
  /**
   * Logger for diagnostic observations (e.g. unsupported-host skip, close-on-dispose failures).
   * Optional so tests can omit it and inherit a silent default.
   */
  logger?: Logger;
}
