import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaneInfoSection } from './PaneInfoSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('PaneInfoSection', () => {
  let fixture: SettingsApiFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createSettingsApiFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.teardown();
  });

  it('updates pane info polling interval', async () => {
    // Given: the Pane info section is visible.
    render(<PaneInfoSection />);

    // When: the user disables polling by entering 0.
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    await vi.advanceTimersByTimeAsync(350);

    // Then: the setting patch preserves the disable value.
    expect(fixture.api.update).toHaveBeenCalledWith({
      terminal: undefined,
      paneInfo: { pollIntervalMs: 0 },
      shortcuts: undefined,
      app: undefined,
      shellIntegration: undefined,
    });
  });
});
