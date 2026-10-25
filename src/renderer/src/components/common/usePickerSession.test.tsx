import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { useUiStore, type UiStoreState } from '../../stores/uiStore';
import { usePickerSession } from './usePickerSession';

const initialUi = useUiStore.getState();
const isOpen = (state: UiStoreState): boolean => state.projectPaletteOpen;
const options = {
  selectIsOpen: isOpen,
  closePicker: initialUi.closeProjectPalette,
  focusRequest: 0,
};

function Picker(): React.JSX.Element {
  const { dialogRef, inputRef, close, onKeyDown } = usePickerSession(options);
  return (
    <div ref={dialogRef} onKeyDown={onKeyDown}>
      <input aria-label="Search" ref={inputRef} />
      <button type="button" onClick={() => close(false)}>
        Navigate
      </button>
    </div>
  );
}

function Host({ showOrigin = true }: { showOrigin?: boolean }): React.JSX.Element {
  const open = useUiStore(isOpen);
  return (
    <>
      {showOrigin && <button type="button">Origin</button>}
      {open && <Picker />}
    </>
  );
}

beforeEach(() => {
  useUiStore.setState({ ...initialUi, activeView: 'agents', projectPaletteOpen: true });
});

afterEach(() => {
  cleanup();
  useUiStore.setState(initialUi, true);
  vi.restoreAllMocks();
});

describe('usePickerSession', () => {
  it('aborts pending work immediately on navigation and ignores its late result', async () => {
    // Given: a submission is waiting for an external operation.
    const { result } = renderHook(() => usePickerSession(options));
    const deferred = Promise.withResolvers<string>();
    const action = vi.fn((_signal: AbortSignal) => deferred.promise);
    const onSuccess = vi.fn();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit(action, onSuccess);
    });

    // When: another view opens while the hook remains mounted, then the operation completes.
    act(() => useUiStore.getState().openSettings());
    expect(action.mock.calls[0]![0].aborted).toBe(true);
    expect(useUiStore.getState().projectPaletteOpen).toBe(false);
    await act(async () => {
      deferred.resolve('created');
      await pending;
    });

    // Then: cancellation prevents the old picker from applying its UI transition, and the
    // still-mounted hook is not left busy.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeView).toBe('settings');
    expect(result.current.busy).toBe(false);
  });

  it('aborts pending work on unmount and ignores late failures', async () => {
    // Given: a pending submission in a mounted picker.
    const { result, unmount } = renderHook(() => usePickerSession(options));
    const deferred = Promise.withResolvers<void>();
    const action = vi.fn((_signal: AbortSignal) => deferred.promise);
    const onSuccess = vi.fn();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit(action, onSuccess);
    });

    // When: the picker unmounts before the operation fails.
    unmount();
    await act(async () => {
      deferred.reject(new Error('Late failure'));
      await pending;
    });

    // Then: the operation is aborted and its stale continuation does not run.
    expect(action.mock.calls[0]![0].aborted).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('guards same-tick submissions and allows retry after a failure', async () => {
    // Given: a deferred operation and two submissions in the same render tick.
    const { result } = renderHook(() => usePickerSession(options));
    const deferred = Promise.withResolvers<string>();
    const action = vi.fn((_signal: AbortSignal) => deferred.promise);
    const onSuccess = vi.fn();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit(action, onSuccess);
      void result.current.submit(action, onSuccess);
    });
    expect(action).toHaveBeenCalledOnce();
    expect(result.current.busy).toBe(true);

    // When: the operation fails, then a new submission succeeds.
    await act(async () => {
      deferred.reject(new Error('Unavailable'));
      await pending;
    });
    expect(result.current.error).toBe('Unavailable');
    expect(result.current.busy).toBe(false);
    await act(async () => result.current.submit(async () => 'created', onSuccess));

    // Then: retries clear the error and pass the result to the caller once.
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('created');
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('records the original focus once across StrictMode replay and restores it on dismissal', () => {
    // Given: a focused origin before the picker mounts under StrictMode.
    useUiStore.setState({ projectPaletteOpen: false });
    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    const origin = screen.getByRole('button', { name: 'Origin' });
    origin.focus();
    act(() => useUiStore.getState().openProjectPalette());
    expect(screen.getByRole('textbox')).toHaveFocus();
    const restore = vi.spyOn(origin, 'focus');

    // When: Escape dismisses the picker after its mount effects have replayed.
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    // Then: the origin, rather than the picker input, is the saved focus destination.
    expect(restore).toHaveBeenCalledOnce();
    expect(origin).toHaveFocus();
  });

  it.each(['another palette', 'another view', 'explicit destination', 'removed origin'] as const)(
    'does not restore focus when leaving for %s',
    (destination) => {
      // Given: an open picker and an observable focus origin.
      useUiStore.setState({ projectPaletteOpen: false });
      const view = render(<Host />);
      const origin = screen.getByRole('button', { name: 'Origin' });
      origin.focus();
      act(() => useUiStore.getState().openProjectPalette());
      const restore = vi.spyOn(origin, 'focus');

      // When: another destination takes focus ownership or the origin is disconnected.
      if (destination === 'another palette') {
        act(() => useUiStore.getState().openTabSearch());
      } else if (destination === 'another view') {
        act(() => useUiStore.getState().openSettings());
      } else if (destination === 'explicit destination') {
        fireEvent.click(screen.getByRole('button', { name: 'Navigate' }));
      } else {
        view.rerender(<Host showOrigin={false} />);
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
      }

      // Then: picker cleanup does not steal focus back to the origin.
      expect(restore).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    },
  );

  it('keeps an in-flight submission alive when inline callbacks change identity', async () => {
    // Given: callbacks recreated on every render, and a pending submission.
    const closePicker = vi.fn();
    const { result, rerender } = renderHook(() =>
      usePickerSession({
        focusRequest: 0,
        selectIsOpen: (state) => state.projectPaletteOpen,
        closePicker: () => closePicker(),
      }),
    );
    const deferred = Promise.withResolvers<string>();
    const action = vi.fn((_signal: AbortSignal) => deferred.promise);
    const onSuccess = vi.fn();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit(action, onSuccess);
    });

    // When: the host re-renders with new callback identities before the operation completes.
    rerender();
    rerender();
    await act(async () => {
      deferred.resolve('created');
      await pending;
    });

    // Then: the session was not restarted, so the result is applied and busy is cleared.
    expect(action.mock.calls[0]![0].aborted).toBe(false);
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('created');
    expect(result.current.busy).toBe(false);

    // When: the session closes through the latest callback.
    act(() => result.current.close());

    // Then: the latest closePicker runs.
    expect(closePicker).toHaveBeenCalledOnce();
  });

  it('lets a child claim Escape without closing the picker or reaching outer handlers', () => {
    // Given: a picker whose input claims Escape, inside an outer Escape handler.
    const outer = vi.fn();
    function ClaimingPicker(): React.JSX.Element {
      const { dialogRef, inputRef, onKeyDown } = usePickerSession(options);
      return (
        <div ref={dialogRef} onKeyDown={onKeyDown}>
          <input
            aria-label="Search"
            ref={inputRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape' || event.key === 'Tab') event.preventDefault();
            }}
          />
          <button type="button">Other</button>
        </div>
      );
    }
    render(
      <div onKeyDown={outer}>
        <ClaimingPicker />
      </div>,
    );
    const input = screen.getByRole('textbox');

    // When: Escape and Tab are pressed in the claiming input.
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Tab' });

    // Then: the picker stays open and keeps focus, and Escape still stops at the modal.
    expect(useUiStore.getState().projectPaletteOpen).toBe(true);
    expect(input).toHaveFocus();
    expect(outer.mock.calls.map(([event]) => (event as KeyboardEvent).key)).toEqual(['Tab']);
  });
});
