import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationSection } from './ApplicationSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('ApplicationSection', () => {
  let fixture: SettingsApiFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createSettingsApiFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.teardown();
  });

  it('updates Cmd+Q confirmation behavior', async () => {
    // Given: the Application section is visible.
    render(<ApplicationSection />);

    // When: the user selects Always.
    const quitGroup = screen.getByRole('group', { name: 'Quit confirmation' });
    fireEvent.click(within(quitGroup).getByRole('radio', { name: /always/i }));
    await vi.advanceTimersByTimeAsync(350);

    // Then: the application setting is persisted.
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: undefined,
      shortcuts: undefined,
      app: { quitConfirm: 'always' },
      shellIntegration: undefined,
    });
  });

  it('updates tab-close confirmation behavior independently', async () => {
    // Given: the Application section exposes a separate tab-close policy group.
    render(<ApplicationSection />);
    const tabCloseGroup = screen.getByRole('group', { name: 'Tab close confirmation' });

    // When: the user selects Always for tab closes.
    fireEvent.click(within(tabCloseGroup).getByRole('radio', { name: /always/i }));
    await vi.advanceTimersByTimeAsync(350);

    // Then: only the tab-close setting is included in the application patch.
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: undefined,
      shortcuts: undefined,
      app: { tabCloseConfirm: 'always' },
      shellIntegration: undefined,
    });
  });
});
