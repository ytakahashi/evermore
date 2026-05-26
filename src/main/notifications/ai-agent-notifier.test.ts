import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../shared/settings-defaults';
import type { NotificationPayload } from '../../shared/notifications';
import type { AppSettings, PaneRuntimeInfo } from '../../shared/types';
import { AiAgentNotifier } from './ai-agent-notifier';
import type { NotificationService } from './notification-service';

// Build the ANSI escape byte at runtime via String.fromCharCode so the source file stays plain
// ASCII on disk. Embedding the raw 0x1B byte directly makes editors and code review tools refuse
// to display the file.
const ESC = String.fromCharCode(0x1b);

interface FakeService {
  show: ReturnType<typeof vi.fn>;
}

function createFakeService(): FakeService {
  return { show: vi.fn(() => 'shown') };
}

function settingsWith(enabled: boolean): AppSettings {
  return {
    ...structuredClone(DEFAULT_APP_SETTINGS),
    notifications: { aiAgentAwaitingInputEnabled: enabled },
  };
}

function paneInfo(overrides: Partial<PaneRuntimeInfo> = {}): PaneRuntimeInfo {
  const base: PaneRuntimeInfo = {
    ptyId: 'pty-1',
    processActivity: 'running',
    foregroundSession: { kind: 'none' },
    integration: { shell: false, protocols: [], lastSequenceAt: 0, stale: false },
    observedAt: 1,
    cwd: '/Users/test/project',
    agent: {
      known: 'claude',
      kind: 'claude',
      status: 'awaiting-input',
      source: 'agent-protocol',
      observedAt: 1,
    },
    attention: { kind: 'awaiting-input', source: 'agent-protocol', observedAt: 1 },
  };
  return { ...base, ...overrides };
}

function makeNotifier(initialSettings: AppSettings): {
  notifier: AiAgentNotifier;
  service: FakeService;
  setSettings: (next: AppSettings) => void;
} {
  let current = initialSettings;
  const service = createFakeService();
  const notifier = new AiAgentNotifier({
    service: service as unknown as NotificationService,
    getSettings: () => current,
  });
  return {
    notifier,
    service,
    setSettings(next) {
      current = next;
    },
  };
}

describe('AiAgentNotifier', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not show a notification when settings disable AI awaiting-input notifications', () => {
    // Given: a notifier wired to a settings snapshot with the toggle off.
    const { notifier, service } = makeNotifier(settingsWith(false));

    // When: an awaiting-input transition is observed.
    notifier.observe(paneInfo());

    // Then: the service is never asked to show anything.
    expect(service.show).not.toHaveBeenCalled();
  });

  it('shows a notification on the first observation of an awaiting-input pane', () => {
    // Given: an enabled notifier with no prior state for the pane.
    const { notifier, service } = makeNotifier(settingsWith(true));

    // When: the first observation reports awaiting-input.
    notifier.observe(paneInfo());

    // Then: the service is called once with the AI awaiting-input payload.
    expect(service.show).toHaveBeenCalledOnce();
    const payload = service.show.mock.calls[0]?.[0] as NotificationPayload;
    expect(payload.title).toBe('Claude Code is waiting for your input');
    expect(payload.id).toBe('ai-agent-awaiting-input:pty-1');
    expect(payload.category).toBe('ai-agent-awaiting-input');
    expect(payload.target?.paneId).toBe('pty-1');
  });

  it('uses the unknown-agent label when the agent slot is undefined', () => {
    // Given: an enabled notifier and a pane without an agent.
    const { notifier, service } = makeNotifier(settingsWith(true));

    // When: the pane reports awaiting-input without a known agent.
    notifier.observe(paneInfo({ agent: undefined }));

    // Then: the title falls back to the generic AI agent label.
    const payload = service.show.mock.calls[0]?.[0] as NotificationPayload;
    expect(payload.title).toBe('AI agent is waiting for your input');
  });

  it('uses agent.detail.message as body and runs it through sanitization', () => {
    // Given: an agent message containing an ANSI escape that must not reach the notification body.
    const dirtyMessage = `${ESC}[31mApprove tool use?${ESC}[0m`;
    const { notifier, service } = makeNotifier(settingsWith(true));

    // When: the observation includes the dirty message.
    notifier.observe(
      paneInfo({
        agent: {
          known: 'claude',
          kind: 'claude',
          status: 'awaiting-input',
          source: 'agent-protocol',
          observedAt: 1,
          detail: { message: dirtyMessage },
        },
      }),
    );

    // Then: the body reaches the service with the escapes stripped.
    const payload = service.show.mock.calls[0]?.[0] as NotificationPayload;
    expect(payload.body).toBe('Approve tool use?');
  });

  it('falls back to the cwd basename when the agent message is missing or empty', () => {
    // Given: an enabled notifier and an injected pathBasename so the test does not depend on host
    // path semantics.
    const service = createFakeService();
    const notifier = new AiAgentNotifier({
      service: service as unknown as NotificationService,
      getSettings: () => settingsWith(true),
      pathBasename: (input: string): string => {
        const trimmed = input.replace(/\/+$/, '');
        const last = trimmed.lastIndexOf('/');
        return last >= 0 ? trimmed.slice(last + 1) : trimmed;
      },
    });

    // When: the pane has no agent message at all.
    notifier.observe(
      paneInfo({
        cwd: '/Users/test/project',
        agent: {
          known: 'claude',
          kind: 'claude',
          status: 'awaiting-input',
          source: 'agent-protocol',
          observedAt: 1,
        },
      }),
    );

    // Then: the body falls back to the pane cwd basename.
    const payload = service.show.mock.calls[0]?.[0] as NotificationPayload;
    expect(payload.body).toBe('project');
  });

  it('does not double-fire while the pane stays in awaiting-input', () => {
    // Given: an enabled notifier with a pane already observed in awaiting-input.
    const { notifier, service } = makeNotifier(settingsWith(true));
    notifier.observe(paneInfo());
    expect(service.show).toHaveBeenCalledOnce();

    // When: the same awaiting-input state is observed again (e.g. a follow-up emit with no real
    // transition).
    notifier.observe(paneInfo());

    // Then: the service is not called a second time.
    expect(service.show).toHaveBeenCalledOnce();
  });

  it('fires again after the pane clears awaiting-input and re-enters it', () => {
    // Given: an enabled notifier whose pane finished a turn and is about to receive a new prompt.
    const { notifier, service } = makeNotifier(settingsWith(true));
    notifier.observe(paneInfo());
    notifier.observe(paneInfo({ attention: undefined }));

    // When: the pane transitions back into awaiting-input.
    notifier.observe(paneInfo());

    // Then: the service fires once per fresh transition.
    expect(service.show).toHaveBeenCalledTimes(2);
  });

  it('ignores further observations after a pane is unregistered, but treats a re-registered id as fresh', () => {
    // Given: an enabled notifier that has already fired for a pane.
    const { notifier, service } = makeNotifier(settingsWith(true));
    notifier.observe(paneInfo());
    notifier.unregister('pty-1');

    // When: a new pane reuses the id and arrives already awaiting input.
    notifier.observe(paneInfo());

    // Then: it fires again because the prior snapshot was dropped.
    expect(service.show).toHaveBeenCalledTimes(2);
  });

  it('respects a runtime OFF toggle for subsequent transitions', () => {
    // Given: an enabled notifier that fired once.
    const { notifier, service, setSettings } = makeNotifier(settingsWith(true));
    notifier.observe(paneInfo());
    expect(service.show).toHaveBeenCalledOnce();

    // When: the user toggles the preference off and a new pane transitions into awaiting-input.
    setSettings(settingsWith(false));
    notifier.observe(paneInfo({ ptyId: 'pty-2' }));

    // Then: the second transition is silent.
    expect(service.show).toHaveBeenCalledOnce();
  });

  it('fires on the first awaiting-input observation after a runtime OFF -> ON toggle without baseline seeding', () => {
    // Given: a notifier that started disabled. The pane has been awaiting input the whole time.
    const { notifier, service, setSettings } = makeNotifier(settingsWith(false));
    notifier.observe(paneInfo());
    expect(service.show).not.toHaveBeenCalled();

    // When: the user enables notifications and another observation arrives for the same pane.
    setSettings(settingsWith(true));
    notifier.observe(paneInfo());

    // Then: the first observe after the toggle fires because no snapshot was recorded while the
    // setting was off — the notifier intentionally has "no prior state" for the pane.
    expect(service.show).toHaveBeenCalledOnce();
  });
});
