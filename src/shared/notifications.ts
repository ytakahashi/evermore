/**
 * Versioned payload accepted by `NotificationService.show()`.
 *
 * The `v` field exists so future fields (target.paneId, image, actions, ...) can be added without
 * breaking older callers that built the payload from outside the app (for example, a future
 * `evermore notify` CLI).
 */
export interface NotificationPayload {
  v: 1;
  /** Required. Notification system tray title. */
  title: string;
  /** Optional body. May be multi-line. */
  body?: string;
  /** macOS-only subtitle line shown between title and body. */
  subtitle?: string;
  /**
   * Logical category reserved for future grouping / filtering.
   * It is not used for cooldown; cooldown is keyed only by `id`.
   * AI agent awaiting-input uses `'ai-agent-awaiting-input'`.
   */
  category?: string;
  /**
   * Stable id for replace / cooldown. If a notification with the same id is shown within the
   * cooldown window, the second show() is suppressed.
   */
  id?: string;
  /** When true, suppress notification sound. Default: false. */
  silent?: boolean;
  /** Reserved for future deep-link target. Initial implementation ignores it. */
  target?: {
    paneId?: string;
    workspaceId?: string;
  };
}

/**
 * Observable result from `NotificationService.show()`.
 *
 * Returned primarily so unit tests and future callers can distinguish an actual notification from
 * a local suppression decision without inspecting logs or Electron fakes.
 */
export type NotificationShowResult = 'shown' | 'suppressed' | 'unsupported';
