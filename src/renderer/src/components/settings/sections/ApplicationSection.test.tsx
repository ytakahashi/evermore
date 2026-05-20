import { fireEvent, render, screen } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('radio', { name: /always/i }));
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
});
