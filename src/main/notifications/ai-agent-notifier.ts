import path from 'node:path';
import { formatAgentDisplayName } from '../../shared/ai-integration/agent-display-name';
import type { NotificationPayload } from '../../shared/notifications';
import type { AppSettings, PaneRuntimeInfo } from '../../shared/types';
import type { NotificationService } from './notification-service';
import { sanitizeNotificationBody } from './sanitize-notification-body';

const NOTIFICATION_CATEGORY = 'ai-agent-awaiting-input';
const NOTIFICATION_ID_PREFIX = 'ai-agent-awaiting-input:';
const MAX_BODY_CHARS = 200;

interface AiAgentNotifierOptions {
  service: NotificationService;
  /**
   * Returns the current resolved settings. Read on every observe so a runtime toggle of the
   * notification preference takes effect without re-subscribing to the settings store.
   */
  getSettings: () => AppSettings;
  /**
   * Override for the cwd basename extraction. Defaults to `path.basename`. Injected so tests can
   * exercise the fallback without depending on host-specific path semantics.
   */
  pathBasename?: (input: string) => string;
}

interface PaneSnapshot {
  awaitingInput: boolean;
}

/**
 * Subscribes to `PaneInfoTracker.callbacks.onChanged` observations and raises a notification when
 * a pane transitions into `attention.kind === 'awaiting-input'`.
 *
 * The notifier owns the transition detection only; cooldown / dedupe is handled by
 * {@link NotificationService}. State is keyed by `ptyId`, and the composition root must call
 * {@link AiAgentNotifier.unregister} when a PTY is disposed so a recycled id starts from a clean
 * slate.
 */
export class AiAgentNotifier {
  private readonly service: NotificationService;
  private readonly getSettings: () => AppSettings;
  private readonly pathBasename: (input: string) => string;
  private readonly snapshots = new Map<string, PaneSnapshot>();

  public constructor(options: AiAgentNotifierOptions) {
    this.service = options.service;
    this.getSettings = options.getSettings;
    this.pathBasename = options.pathBasename ?? path.basename;
  }

  /**
   * Records a tracker observation for the given pane. Triggers a notification when the pane's
   * `attention.kind` transitions into `'awaiting-input'`.
   *
   * The very first observe for a pane id is treated as `prev.awaitingInput === false`, so a pane
   * that arrives already awaiting input still fires once. The setting toggle is read through on
   * every call to avoid a stale cached flag.
   */
  public observe(info: PaneRuntimeInfo): void {
    // Snapshots are intentionally only recorded while the feature is enabled. A toggle from
    // disabled to enabled then behaves as documented: the next `observe` for any pane is treated
    // as "no prior state", so a pane already sitting in `awaiting-input` fires once on the first
    // observation after the toggle. Close-in-time duplicates are deduped by NotificationService's
    // id cooldown rather than by a baseline seed here.
    if (!this.getSettings().notifications.aiAgentAwaitingInputEnabled) {
      return;
    }

    const isAwaiting = info.attention?.kind === 'awaiting-input';
    const previous = this.snapshots.get(info.ptyId);
    const wasAwaiting = previous?.awaitingInput ?? false;
    this.snapshots.set(info.ptyId, { awaitingInput: isAwaiting });

    if (!isAwaiting || wasAwaiting) {
      return;
    }

    this.service.show(this.buildPayload(info));
  }

  /** Drops cached state for a pane. Call from the PTY dispose path. */
  public unregister(ptyId: string): void {
    this.snapshots.delete(ptyId);
  }

  private buildPayload(info: PaneRuntimeInfo): NotificationPayload {
    const agentName = formatAgentDisplayName(info.agent);
    const sanitizedMessage = sanitizeNotificationBody(info.agent?.detail?.message, MAX_BODY_CHARS);
    const body = sanitizedMessage || this.cwdBasename(info.cwd) || undefined;

    return {
      v: 1,
      title: `${agentName} is waiting for your input`,
      ...(body !== undefined ? { body } : {}),
      category: NOTIFICATION_CATEGORY,
      id: `${NOTIFICATION_ID_PREFIX}${info.ptyId}`,
      silent: false,
      target: { paneId: info.ptyId },
    };
  }

  private cwdBasename(cwd: string | undefined): string {
    if (!cwd) {
      return '';
    }
    const base = this.pathBasename(cwd);
    return base.trim();
  }
}
