import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';
import { NotificationsSection } from './NotificationsSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('NotificationsSection', () => {
  let fixture: SettingsApiFixture | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture?.teardown();
    fixture = undefined;
  });

  it('reads back the persisted AI awaiting-input toggle as the checkbox state', () => {
    // Given: the user has enabled AI awaiting-input notifications.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        notifications: { aiAgentAwaitingInputEnabled: true },
      },
    });

    // When: the section renders.
    render(<NotificationsSection />);

    // Then: the toggle reflects the persisted state.
    const toggle = screen.getByRole('checkbox', {
      name: 'Notify when an AI agent is waiting for input',
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('defaults to the disabled state when nothing has been persisted', () => {
    // Given: a fresh settings fixture using built-in defaults.
    fixture = createSettingsApiFixture();

    // When: the section renders.
    render(<NotificationsSection />);

    // Then: the default-off state is shown.
    const toggle = screen.getByRole('checkbox', {
      name: 'Notify when an AI agent is waiting for input',
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('forwards toggle changes through the settings store', async () => {
    // Given: the section rendered with defaults.
    fixture = createSettingsApiFixture();
    render(<NotificationsSection />);

    // When: the user enables the toggle.
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Notify when an AI agent is waiting for input' }),
    );

    // Then: optimistic state flips immediately.
    expect(useSettingsStore.getState().settings?.notifications.aiAgentAwaitingInputEnabled).toBe(
      true,
    );

    // And: the patch reaches the main process after the debounce, scoped to notifications only.
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ notifications: { aiAgentAwaitingInputEnabled: true } }),
    );
  });

  it('references the AI Integration section as a prerequisite', () => {
    // Given: the section rendered with defaults.
    fixture = createSettingsApiFixture();

    // When: rendered.
    render(<NotificationsSection />);

    // Then: the description points users at the AI Integration section so they understand why
    // notifications might silently never arrive.
    expect(screen.getByText(/AI Integration/)).toBeInTheDocument();
  });
});
