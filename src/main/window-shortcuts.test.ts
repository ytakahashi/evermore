import type { BrowserWindow, Input } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { attachWindowShortcuts } from './window-shortcuts';

vi.mock('@electron-toolkit/utils', () => ({
  // The default branch of `attachWindowShortcuts` reads `is.dev`. Tests always inject `isDev`
  // explicitly, so the mock value here only guards against accidental real imports during the
  // module graph walk in jsdom.
  is: { dev: false },
}));

type BeforeInputListener = (event: { preventDefault: () => void }, input: Input) => void;

interface ShortcutHarness {
  invoke: (input: Partial<Input> & Pick<Input, 'type' | 'code'>) => boolean;
}

function createHarness({ isDev = false }: { isDev?: boolean } = {}): ShortcutHarness {
  let registeredListener: BeforeInputListener | null = null;
  const onSpy = vi.fn((channel: string, listener: BeforeInputListener) => {
    if (channel === 'before-input-event') {
      registeredListener = listener;
    }
  });
  const fakeWindow = {
    webContents: { on: onSpy },
  } as unknown as BrowserWindow;

  attachWindowShortcuts(fakeWindow, { isDev });

  return {
    invoke: (partial) => {
      if (!registeredListener) {
        throw new Error('Listener was not registered');
      }
      const preventDefault = vi.fn();
      // The Electron `Input` type carries more fields than the listener consumes (e.g. `key`,
      // `location`, `modifiers`). Filling defaults here keeps tests readable.
      const input: Input = {
        type: partial.type,
        key: partial.key ?? '',
        code: partial.code,
        isAutoRepeat: partial.isAutoRepeat ?? false,
        isComposing: partial.isComposing ?? false,
        shift: partial.shift ?? false,
        control: partial.control ?? false,
        alt: partial.alt ?? false,
        meta: partial.meta ?? false,
        location: partial.location ?? 0,
        modifiers: partial.modifiers ?? [],
      };
      registeredListener({ preventDefault }, input);
      return preventDefault.mock.calls.length > 0;
    },
  };
}

describe('attachWindowShortcuts', () => {
  it('lets Ctrl+R reach the renderer for shell reverse-i-search', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When: the user presses Ctrl+R.
    const blocked = invoke({ type: 'keyDown', code: 'KeyR', control: true });

    // Then: the event is not preventDefault'd, so xterm receives DC2 for reverse-i-search.
    expect(blocked).toBe(false);
  });

  it('blocks Cmd+R so the renderer does not reload', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When: the user presses Cmd+R.
    const blocked = invoke({ type: 'keyDown', code: 'KeyR', meta: true });

    // Then: the event is preventDefault'd to suppress renderer reload.
    expect(blocked).toBe(true);
  });

  it('blocks Cmd+- and Cmd+= to keep renderer zoom from desyncing xterm', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When/Then: Cmd+- and Cmd+= are both preventDefault'd.
    expect(invoke({ type: 'keyDown', code: 'Minus', meta: true })).toBe(true);
    expect(invoke({ type: 'keyDown', code: 'Equal', meta: true })).toBe(true);
  });

  it('lets Ctrl+- and Ctrl+= pass through so terminals can consume them', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When/Then: Ctrl+- and Ctrl+= reach the renderer untouched.
    expect(invoke({ type: 'keyDown', code: 'Minus', control: true })).toBe(false);
    expect(invoke({ type: 'keyDown', code: 'Equal', control: true })).toBe(false);
  });

  it('blocks Cmd+Option+I in production but lets it open DevTools in dev', () => {
    // Given: production and dev harnesses.
    const prod = createHarness({ isDev: false });
    const dev = createHarness({ isDev: true });

    // When/Then: production blocks Cmd+Option+I; dev passes it through to Electron's default.
    expect(prod.invoke({ type: 'keyDown', code: 'KeyI', meta: true, alt: true })).toBe(true);
    expect(dev.invoke({ type: 'keyDown', code: 'KeyI', meta: true, alt: true })).toBe(false);
  });

  it('ignores keyUp events even when Cmd is held', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When: the user releases Cmd+R (keyUp).
    const blocked = invoke({ type: 'keyUp', code: 'KeyR', meta: true });

    // Then: keyUp is not preventDefault'd; only keyDown participates in the suppression contract.
    expect(blocked).toBe(false);
  });

  it('ignores unmodified KeyR (so typing "r" keeps working)', () => {
    // Given: a window with shortcuts attached.
    const { invoke } = createHarness();

    // When: the user types `r` without modifiers.
    const blocked = invoke({ type: 'keyDown', code: 'KeyR' });

    // Then: the renderer receives the event normally.
    expect(blocked).toBe(false);
  });
});
