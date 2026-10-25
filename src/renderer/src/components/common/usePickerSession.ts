import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { selectIsPaletteOpen, useUiStore, type UiStoreState } from '../../stores/uiStore';

interface PickerSessionOptions {
  focusRequest: number;
  /** Reports whether this picker is still the open one. Read at call time, so it may be inline. */
  selectIsOpen: (state: UiStoreState) => boolean;
  /** Clears this picker's open flag. Read at call time, so it may be inline. */
  closePicker: () => void;
}

interface PickerSession {
  dialogRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  error: string | null;
  close: (restoreFocus?: boolean) => void;
  submit: <T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSuccess: (result: T) => void,
  ) => Promise<void>;
  /**
   * Handles Escape and Tab for the dialog. A child that calls `preventDefault()` on a key keeps it,
   * which lets a multi-step picker turn Escape into "go back" instead of "close".
   */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** Owns cancellation, focus, and keyboard boundaries for one mounted modal picker session. */
export function usePickerSession({
  focusRequest,
  selectIsOpen,
  closePicker,
}: PickerSessionOptions): PickerSession {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const submittingRef = useRef(false);
  const restoreFocusRef = useRef(true);
  // StrictMode replays layout effects after the input is focused. Capture the origin only once.
  const previousFocusRef = useRef<Element | null>(null);
  // Latest callbacks, so the session effect below runs once per mount. Re-running it on a new
  // callback identity would abort the controller and silently drop an in-flight submission.
  const selectIsOpenRef = useRef(selectIsOpen);
  const closePickerRef = useRef(closePicker);

  // Declared before the session effect so a commit refreshes the callbacks before anything reads
  // them; the subscription and handlers only run after commit.
  useLayoutEffect(() => {
    selectIsOpenRef.current = selectIsOpen;
    closePickerRef.current = closePicker;
  });

  // Capture focus before paint and restore it before the next view's passive focus effects run.
  useLayoutEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const unsubscribe = useUiStore.subscribe((current, previous) => {
      if (current.activeView !== previous.activeView && selectIsOpenRef.current(current)) {
        controller.abort();
        closePickerRef.current();
      }
    });
    const previousFocus = (previousFocusRef.current ??= document.activeElement);
    const previousView = useUiStore.getState().activeView;
    inputRef.current?.focus();
    return () => {
      unsubscribe();
      controller.abort();
      const ui = useUiStore.getState();
      // Another palette or an explicit navigation destination owns the next focus target.
      if (
        restoreFocusRef.current &&
        !selectIsPaletteOpen(ui) &&
        ui.activeView === previousView &&
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected
      ) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusRequest]);

  const close = (restoreFocus = true): void => {
    restoreFocusRef.current = restoreFocus;
    // Abort cannot undo persisted work; it invalidates the pending UI continuation immediately.
    controllerRef.current?.abort();
    closePickerRef.current();
  };

  const submit = async <T>(
    action: (signal: AbortSignal) => Promise<T>,
    onSuccess: (result: T) => void,
  ): Promise<void> => {
    const controller = controllerRef.current;
    // State updates lag a render behind, so same-tick submissions need a synchronous guard.
    if (submittingRef.current || !controller || controller.signal.aborted) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    const previousView = useUiStore.getState().activeView;
    // The user may dismiss the picker or navigate away during IPC. The work stays persisted, but
    // its continuation must not override the view they moved to or report into a closed picker.
    const isCurrent = (): boolean => {
      const ui = useUiStore.getState();
      return (
        !controller.signal.aborted && selectIsOpenRef.current(ui) && ui.activeView === previousView
      );
    };
    try {
      const result = await action(controller.signal);
      if (isCurrent()) onSuccess(result);
    } catch (caught: unknown) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : 'Unknown error');
    } finally {
      submittingRef.current = false;
      // Unconditional: a stale submission must not leave a still-mounted picker stuck as busy, and
      // a state update after unmount is a no-op.
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // IME Escape cancels composition without reaching view-level Escape handlers.
    if (event.nativeEvent.isComposing) {
      if (event.key === 'Escape') event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      // Stop propagation even when a child claimed Escape, so it never reaches view-level
      // handlers such as Agents view's Escape-to-return behind the modal.
      event.stopPropagation();
      if (event.defaultPrevented) return;
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      if (event.defaultPrevented) return;
      // Options use aria-activedescendant and arrow navigation instead of separate tab stops.
      const controls = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled):not([role="option"])',
        ) ?? []),
      ];
      const current = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
  };

  return { dialogRef, inputRef, busy, error, close, submit, onKeyDown };
}
