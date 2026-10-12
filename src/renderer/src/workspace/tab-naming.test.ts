import { describe, expect, it } from 'vite-plus/test';
import type { Tab } from '../../../shared/types';
import { getAutomaticTabName, setTabActivePane, syncTabNameWithPane } from './tab-naming';

function createTab(): Tab {
  return {
    id: 'tab',
    name: 'old',
    isCustomName: false,
    layout: { type: 'leaf', paneId: 'pane' },
    activePaneId: null,
  };
}

describe('getAutomaticTabName', () => {
  it.each([
    ['/project/app', 'app'],
    ['/project/app/', 'app'],
    ['', 'Tab'],
    ['/', 'Tab'],
  ])('names cwd %s as %s', (cwd, expected) => {
    // Given: a pane cwd including empty and root paths.

    // When: its automatic tab name is derived.
    const name = getAutomaticTabName(cwd);

    // Then: the basename or fallback is returned.
    expect(name).toBe(expected);
  });
});

describe('syncTabNameWithPane', () => {
  it('preserves tab identity for custom or unchanged names', () => {
    // Given: a custom tab and an automatically named tab already matching its pane.
    const custom = { ...createTab(), isCustomName: true };
    const automatic = { ...createTab(), name: 'app' };
    const pane = { id: 'pane', cwd: '/project/app' };
    const before = structuredClone([custom, automatic]);

    // When: names are reconciled.
    const customResult = syncTabNameWithPane(custom, pane);
    const automaticResult = syncTabNameWithPane(automatic, pane);

    // Then: both tabs are returned by reference and neither is mutated.
    expect(customResult).toBe(custom);
    expect(automaticResult).toBe(automatic);
    expect([custom, automatic]).toEqual(before);
  });
});

describe('setTabActivePane', () => {
  it('updates selection and automatic naming without changing either input', () => {
    // Given: a tab with no selected pane and a pane with a new cwd.
    const tab = createTab();
    const pane = { id: 'pane', cwd: '/project/app' };
    const before = structuredClone({ tab, pane });

    // When: the pane becomes active.
    const result = setTabActivePane(tab, pane);

    // Then: selection and name change in a new tab object.
    expect(result).toEqual({ ...before.tab, activePaneId: 'pane', name: 'app' });
    expect({ tab, pane }).toEqual(before);
  });
});
