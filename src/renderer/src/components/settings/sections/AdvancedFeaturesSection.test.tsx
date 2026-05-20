import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_SETTINGS } from '../../../../../shared/settings-defaults';
import { useSettingsStore } from '../../../stores/settingsStore';
import { AdvancedFeaturesSection } from './AdvancedFeaturesSection';
import {
  createSettingsApiFixture,
  type SettingsApiFixture,
} from './__test-utils__/settingsApiFixture';

describe('AdvancedFeaturesSection', () => {
  let fixture: SettingsApiFixture | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture?.teardown();
    fixture = undefined;
  });

  it('reflects the persisted auto-inject value as the checked state', () => {
    // Given: the user has disabled auto-injection.
    fixture = createSettingsApiFixture({
      initial: {
        ...DEFAULT_APP_SETTINGS,
        shellIntegration: { autoInject: false },
      },
    });

    // When: the section is rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the toggle reads back the persisted disabled state.
    const toggle = screen.getByRole('checkbox', { name: 'Automatic shell integration (zsh)' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('persists a toggle change through the settings store', async () => {
    // Given: the section is visible with auto-inject ON (default).
    fixture = createSettingsApiFixture();
    render(<AdvancedFeaturesSection />);

    // When: the user disables auto-injection.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic shell integration (zsh)' }));

    // Then: the optimistic state flips immediately.
    expect(useSettingsStore.getState().settings?.shellIntegration.autoInject).toBe(false);

    // And: after the debounce, the patch reaches the main process with only the
    // shellIntegration section set.
    await vi.advanceTimersByTimeAsync(350);
    expect(fixture.api.update).toHaveBeenCalledWith(
      expect.objectContaining({ shellIntegration: { autoInject: false } }),
    );
  });

  it('explains that the toggle only affects new panes', () => {
    // Given: the section is rendered with defaults.
    fixture = createSettingsApiFixture();

    // When: the description is rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the copy makes it clear existing PTYs are not affected (a load-bearing detail —
    // the injector deliberately does not retroactively change running shells).
    expect(screen.getByText(/Takes effect for new panes only/i)).toBeInTheDocument();
  });

  it('notes that other shells and remote shells are out of scope', () => {
    // Given: the section is rendered with defaults.
    fixture = createSettingsApiFixture();

    // When: rendered.
    render(<AdvancedFeaturesSection />);

    // Then: the copy explicitly excludes bash / fish and remote shells so users do not expect
    // those panes to gain shell integration from this toggle.
    expect(screen.getByText(/Other shells \(bash, fish\)/i)).toBeInTheDocument();
    expect(screen.getByText(/remote shells are not auto-injected/i)).toBeInTheDocument();
  });
});
