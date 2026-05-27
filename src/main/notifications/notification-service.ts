import { Notification, type NotificationConstructorOptions } from 'electron';
import type { NotificationPayload, NotificationShowResult } from '../../shared/notifications';
import { createSilentLogger, type Logger } from '../logging/logger';
import type { NotificationLike, NotificationServiceOptions } from './types';

const DEFAULT_COOLDOWN_MS = 10_000;

/**
 * Thin macOS notification surface that knows how to translate a serializable
 * {@link NotificationPayload} into an Electron `Notification` and focus the window on click.
 *
 * The service is intentionally agnostic of AI agents, panes, and workspaces. Any consumer that
 * produces a {@link NotificationPayload} can drive it (for example, a future `evermore notify`
 * CLI). Cooldown is the only de-duplication mechanism, keyed by `payload.id`.
 */
export class NotificationService {
  private readonly getWindow: () => Electron.BrowserWindow | null;
  private readonly isSupported: () => boolean;
  private readonly createNotification: (
    options: NotificationConstructorOptions,
  ) => NotificationLike;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly logger: Logger;

  private readonly lastShownAt = new Map<string, number>();
  private readonly activeNotifications = new Set<NotificationLike>();

  public constructor(options: NotificationServiceOptions) {
    this.getWindow = options.getWindow;
    this.isSupported = options.isSupported ?? (() => Notification.isSupported());
    this.createNotification =
      options.createNotification ??
      ((notificationOptions): NotificationLike =>
        new Notification(notificationOptions) as unknown as NotificationLike);
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.logger = options.logger ?? createSilentLogger();
  }

  /**
   * Shows a notification and returns a result describing what happened.
   *
   * The return value is the observation surface that unit tests rely on: callers do not need to
   * inspect Electron internals to know whether the notification was actually emitted, suppressed
   * by cooldown, or skipped because the host cannot show notifications at all.
   */
  public show(payload: NotificationPayload): NotificationShowResult {
    if (!this.isSupported()) {
      // Notifications can be unavailable in dev mode (e.g. unsigned dev shells without a stable
      // bundle id) and on hosts that disable user notifications. Logging keeps the failure
      // discoverable without escalating to a runtime error.
      this.logger.debug('Notifications are not supported on this host; skipping show().');
      return 'unsupported';
    }

    if (payload.id !== undefined) {
      const last = this.lastShownAt.get(payload.id);
      if (last !== undefined && this.now() - last < this.cooldownMs) {
        return 'suppressed';
      }
    }

    const notification = this.createNotification({
      title: payload.title,
      ...(payload.body !== undefined ? { body: payload.body } : {}),
      ...(payload.subtitle !== undefined ? { subtitle: payload.subtitle } : {}),
      ...(payload.silent !== undefined ? { silent: payload.silent } : {}),
    });

    const release = (): void => {
      this.activeNotifications.delete(notification);
    };

    notification.on('click', () => {
      this.focusWindow();
      release();
    });
    notification.on('close', release);
    notification.on('failed', release);

    this.activeNotifications.add(notification);
    notification.show();

    if (payload.id !== undefined) {
      this.lastShownAt.set(payload.id, this.now());
    }

    return 'shown';
  }

  /** Closes any in-flight notifications and clears internal cooldown state. */
  public dispose(): void {
    for (const notification of this.activeNotifications) {
      try {
        notification.close();
      } catch (error: unknown) {
        // Closing a notification that has already been dismissed by the system can throw on some
        // platforms; swallow so dispose() stays best-effort during app shutdown.
        this.logger.debug('Failed to close active notification during dispose', error);
      }
    }
    this.activeNotifications.clear();
    this.lastShownAt.clear();
  }

  private focusWindow(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
  }
}
