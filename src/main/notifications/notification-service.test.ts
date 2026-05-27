import type { BrowserWindow, NotificationConstructorOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPayload } from '../../shared/notifications';
import { createLogger, type LogRecord, type LogTransport } from '../logging/logger';
import { NotificationService } from './notification-service';
import type { NotificationLike } from './types';

function createRecordingLogger(): {
  logger: ReturnType<typeof createLogger>;
  records: LogRecord[];
} {
  const records: LogRecord[] = [];
  const transport: LogTransport = {
    write(record) {
      records.push(record);
    },
  };
  return { logger: createLogger({ level: 'debug', transport }), records };
}

type FakeNotificationEvent = 'click' | 'close' | 'failed';

interface FakeNotification extends NotificationLike {
  options: NotificationConstructorOptions;
  showCalls: number;
  closeCalls: number;
  emit: (event: FakeNotificationEvent) => void;
}

function createFakeNotification(options: NotificationConstructorOptions): FakeNotification {
  const listeners: Record<FakeNotificationEvent, Array<() => void>> = {
    click: [],
    close: [],
    failed: [],
  };
  const instance = {
    options,
    showCalls: 0,
    closeCalls: 0,
    show: vi.fn(() => {
      instance.showCalls += 1;
    }),
    close: vi.fn(() => {
      instance.closeCalls += 1;
    }),
    on(event: FakeNotificationEvent, listener: () => void) {
      listeners[event].push(listener);
      return instance as unknown as NotificationLike;
    },
    emit(event: FakeNotificationEvent): void {
      for (const listener of [...listeners[event]]) {
        listener();
      }
    },
  };
  return instance as unknown as FakeNotification;
}

interface FakeWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function createFakeWindow(
  overrides: Partial<{ destroyed: boolean; minimized: boolean }> = {},
): FakeWindow {
  return {
    isDestroyed: vi.fn(() => overrides.destroyed === true),
    isMinimized: vi.fn(() => overrides.minimized === true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  };
}

function payload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    v: 1,
    title: 'test',
    ...overrides,
  };
}

interface ServiceHarness {
  service: NotificationService;
  created: FakeNotification[];
  window: FakeWindow | null;
}

function setupService(
  options: {
    nowValues?: number[];
    isSupported?: () => boolean;
    cooldownMs?: number;
    window?: FakeWindow | null;
    logger?: ReturnType<typeof createLogger>;
  } = {},
): ServiceHarness {
  const nowValues = options.nowValues ?? [0];
  let index = 0;
  const now = (): number => {
    const value = nowValues[Math.min(index, nowValues.length - 1)];
    index += 1;
    return value ?? 0;
  };

  const created: FakeNotification[] = [];
  const window = options.window === undefined ? createFakeWindow() : options.window;
  const service = new NotificationService({
    getWindow: () => (window as unknown as BrowserWindow) ?? null,
    isSupported: options.isSupported ?? ((): boolean => true),
    createNotification: (notificationOptions) => {
      const fake = createFakeNotification(notificationOptions);
      created.push(fake);
      return fake;
    },
    now,
    cooldownMs: options.cooldownMs,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return { service, created, window };
}

describe('NotificationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes title / body / subtitle / silent through to the factory and returns "shown"', () => {
    // Given: a service whose factory records its constructor options.
    const { service, created } = setupService();

    // When: a fully populated payload is shown.
    const result = service.show(
      payload({ title: 'Hi', body: 'there', subtitle: 'now', silent: true }),
    );

    // Then: the factory receives the canonical Electron option keys.
    expect(result).toBe('shown');
    expect(created).toHaveLength(1);
    expect(created[0]?.options).toEqual({
      title: 'Hi',
      body: 'there',
      subtitle: 'now',
      silent: true,
    });
    expect(created[0]?.showCalls).toBe(1);
  });

  it('returns "unsupported" without creating a notification when isSupported is false', () => {
    // Given: a host that reports notifications as unavailable and a recording logger.
    const { logger, records } = createRecordingLogger();
    const { service, created } = setupService({ isSupported: () => false, logger });

    // When: a payload is shown.
    const result = service.show(payload());

    // Then: nothing is constructed, the unsupported sentinel is returned, and the diagnostic is
    // routed through the injected logger rather than console.
    expect(result).toBe('unsupported');
    expect(created).toHaveLength(0);
    expect(records).toEqual([
      expect.objectContaining({
        level: 'debug',
        message: 'Notifications are not supported on this host; skipping show().',
      }),
    ]);
  });

  it('suppresses a second show of the same id within the cooldown window', () => {
    // Given: a service with a 1000ms cooldown and a clock that advances 200ms between calls.
    const { service, created } = setupService({
      nowValues: [0, 200],
      cooldownMs: 1000,
    });

    // When: the same id is shown twice in quick succession.
    const first = service.show(payload({ id: 'pane:1' }));
    const second = service.show(payload({ id: 'pane:1' }));

    // Then: only the first is emitted; the second is rate-limited.
    expect(first).toBe('shown');
    expect(second).toBe('suppressed');
    expect(created).toHaveLength(1);
  });

  it('fires again once the cooldown window has elapsed', () => {
    // Given: a service whose clock advances past the cooldown between calls.
    const { service, created } = setupService({
      nowValues: [0, 1500, 1500],
      cooldownMs: 1000,
    });

    // When: the same id is shown twice across the cooldown boundary.
    service.show(payload({ id: 'pane:1' }));
    const second = service.show(payload({ id: 'pane:1' }));

    // Then: both fire.
    expect(second).toBe('shown');
    expect(created).toHaveLength(2);
  });

  it('does not cooldown payloads without an id', () => {
    // Given: a service with a long cooldown but no id keys on the payloads.
    const { service, created } = setupService({
      nowValues: [0, 100],
      cooldownMs: 60_000,
    });

    // When: two payloads without ids are shown back-to-back.
    service.show(payload());
    service.show(payload());

    // Then: both fire because cooldown is id-keyed.
    expect(created).toHaveLength(2);
  });

  it('treats payloads with the same category but different ids as independent', () => {
    // Given: a service with a long cooldown.
    const { service, created } = setupService({
      nowValues: [0, 100],
      cooldownMs: 60_000,
    });

    // When: two payloads share a category but differ in id.
    service.show(payload({ category: 'shared', id: 'pane:1' }));
    service.show(payload({ category: 'shared', id: 'pane:2' }));

    // Then: both fire independently.
    expect(created).toHaveLength(2);
  });

  it('focuses the window on click and releases the held notification reference', () => {
    // Given: a service and a non-destroyed window.
    const { service, created, window } = setupService();
    service.show(payload({ id: 'pane:1' }));
    const notification = created[0];
    expect(notification).toBeDefined();
    if (!notification) {
      throw new Error('notification was not created');
    }

    // When: the user clicks the notification.
    notification.emit('click');

    // Then: the window is brought forward and the active set is empty.
    expect(window?.show).toHaveBeenCalledOnce();
    expect(window?.focus).toHaveBeenCalledOnce();
    // Subsequent dispose() must not double-close — the click release already cleared the entry.
    service.dispose();
    expect(notification.closeCalls).toBe(0);
  });

  it('restores a minimized window on click before focusing it', () => {
    // Given: a service whose window is currently minimized.
    const minimizedWindow = createFakeWindow({ minimized: true });
    const { service, created } = setupService({ window: minimizedWindow });
    service.show(payload({ id: 'pane:1' }));

    // When: the user clicks the notification.
    created[0]?.emit('click');

    // Then: the window is restored before being focused.
    expect(minimizedWindow.restore).toHaveBeenCalledOnce();
    expect(minimizedWindow.focus).toHaveBeenCalledOnce();
  });

  it('does not call focus when the window has been destroyed', () => {
    // Given: a service whose getWindow returns a destroyed window.
    const destroyedWindow = createFakeWindow({ destroyed: true });
    const { service, created } = setupService({ window: destroyedWindow });
    service.show(payload({ id: 'pane:1' }));

    // When: the user clicks the notification after the window has been torn down.
    created[0]?.emit('click');

    // Then: the destroyed window is not touched.
    expect(destroyedWindow.show).not.toHaveBeenCalled();
    expect(destroyedWindow.focus).not.toHaveBeenCalled();
  });

  it('releases the notification reference on close and on failed too', () => {
    // Given: two shown notifications, one of which fails and the other closes naturally.
    const { service, created } = setupService();
    service.show(payload());
    service.show(payload());
    expect(created).toHaveLength(2);

    // When: each notification fires its lifecycle event.
    created[0]?.emit('close');
    created[1]?.emit('failed');

    // Then: dispose() has nothing left to close.
    service.dispose();
    expect(created[0]?.closeCalls).toBe(0);
    expect(created[1]?.closeCalls).toBe(0);
  });

  it('closes any still-active notifications and clears state on dispose', () => {
    // Given: a service holding an active notification that never fired close/failed/click.
    const { service, created } = setupService({ nowValues: [0, 100, 100], cooldownMs: 60_000 });
    service.show(payload({ id: 'pane:1' }));

    // When: dispose is called.
    service.dispose();

    // Then: the held instance is closed and cooldown state is dropped.
    expect(created[0]?.closeCalls).toBe(1);
    // After dispose the same id can fire again immediately.
    const afterDispose = service.show(payload({ id: 'pane:1' }));
    expect(afterDispose).toBe('shown');
  });
});
