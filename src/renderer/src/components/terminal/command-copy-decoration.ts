import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import type { TerminalCommandCopyController, TerminalCommandCopyState } from './command-copy';
import type { CommandCopyMode } from './command-output';
import type {
  TerminalCommandToolbarHost,
  TerminalCommandToolbarHover,
} from './command-toolbar-hover';

export interface TerminalCommandCopyDecorationOptions {
  terminal: Terminal;
  entry: TerminalCommandHistoryEntry;
  copyController: TerminalCommandCopyController;
  hover: TerminalCommandToolbarHover;
  onDisposed?: () => void;
  /** Lets the owner restore focus after history removal, but never during owner teardown. */
  onFocusedEntryRemoved?: () => void;
}

export interface TerminalCommandCopyDecoration extends IDisposable {
  /** Removes a history entry's presentation, restoring focus when its toolbar had focus. */
  disposeForRemoval: () => void;
}

const actions: readonly { mode: CommandCopyMode; label: string; text: string }[] = [
  { mode: 'command-and-output', label: 'Copy command and output', text: 'C+O' },
  { mode: 'output', label: 'Copy output', text: 'O' },
  { mode: 'command', label: 'Copy command', text: 'C' },
];

/** Displays three copy actions and independent feedback without owning copy state or history markers. */
export function createTerminalCommandCopyDecoration(
  options: TerminalCommandCopyDecorationOptions,
): TerminalCommandCopyDecoration | null {
  if (options.entry.blockStartMarker.isDisposed) {
    return null;
  }
  return new CommandCopyDecorationController(options);
}

class CommandCopyDecorationController implements TerminalCommandCopyDecoration {
  private toolbarDecoration: IDecoration | undefined;
  private toolbarSubscriptions: IDisposable[] = [];
  private indicatorDecoration: IDecoration | undefined;
  private indicatorSubscriptions: IDisposable[] = [];
  private toolbar: HTMLDivElement | null = null;
  private indicator: HTMLSpanElement | null = null;
  private readonly buttons = new Map<CommandCopyMode, HTMLButtonElement>();
  private readonly subscriptions: IDisposable[];
  private readonly hoverHost: TerminalCommandToolbarHost;
  private hovered = false;
  private representative = true;
  private pendingFocus: CommandCopyMode | null = null;
  private disposed = false;

  public constructor(private readonly options: TerminalCommandCopyDecorationOptions) {
    this.hoverHost = options.hover.register(
      options.entry.blockStartMarker,
      (hovered, representative) => {
        this.hovered = hovered;
        this.representative = representative;
        this.updateToolbar();
      },
    );
    this.subscriptions = [
      options.copyController.onStateChange(() => this.update()),
      options.terminal.onResize(() => this.rebuild()),
      options.terminal.buffer.onBufferChange(() => this.rebuild()),
      options.entry.blockStartMarker.onDispose(() => this.disposeForRemoval()),
    ];
    this.rebuild();
  }

  public dispose(): void {
    this.disposePresentation(false);
  }

  public disposeForRemoval(): void {
    this.disposePresentation(true);
  }

  private disposePresentation(entryRemoved: boolean): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const wasFocused = this.focusedMode() !== null;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.hoverHost.dispose();
    this.clearToolbar();
    this.clearIndicator();
    this.pendingFocus = null;
    // Explicit disposal includes replacement and pane teardown, which must not redirect focus.
    if (entryRemoved && wasFocused && this.options.terminal.element?.isConnected) {
      this.options.onFocusedEntryRemoved?.();
    }
    this.options.onDisposed?.();
  }

  private rebuild(): void {
    if (this.disposed) {
      return;
    }
    const focused = this.focusedMode();
    if (focused !== null) {
      this.pendingFocus = focused;
    }
    // Unsubscribe before replacing decorations: a renderer disposal is not an entry disposal.
    this.clearToolbar();
    this.clearIndicator();
    if (
      this.options.terminal.buffer.active.type !== 'normal' ||
      this.options.entry.blockStartMarker.isDisposed
    ) {
      return;
    }
    this.toolbarDecoration = this.options.terminal.registerDecoration({
      marker: this.options.entry.blockStartMarker,
      width: this.options.terminal.cols,
      height: 1,
      layer: 'top',
    });
    if (this.toolbarDecoration) {
      this.toolbarSubscriptions = [
        this.toolbarDecoration.onRender((element) => this.renderToolbar(element)),
        this.toolbarDecoration.onDispose(() => this.clearToolbar()),
      ];
    }
    this.update();
  }

  private renderToolbar(element: HTMLElement): void {
    if (this.disposed) {
      return;
    }
    element.classList.add('evermore-command-copy-decoration');
    if (this.toolbar?.parentElement !== element) {
      const focused = this.focusedMode();
      if (focused !== null) {
        this.pendingFocus = focused;
      }
      this.removeToolbar();
      const toolbar = element.ownerDocument.createElement('div');
      toolbar.className = 'evermore-command-copy-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      const code = this.options.entry.exitCode;
      toolbar.setAttribute(
        'aria-label',
        code === null
          ? 'Command actions (exit status unknown)'
          : `Command actions (exit status ${code})`,
      );
      toolbar.title = code === null ? 'Exit status unknown' : `Exit status ${code}`;
      for (const action of actions) {
        const button = element.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'evermore-command-copy-button';
        button.dataset.mode = action.mode;
        button.setAttribute('aria-label', action.label);
        button.title = action.label;
        button.textContent = action.text;
        toolbar.appendChild(button);
        this.buttons.set(action.mode, button);
      }
      toolbar.addEventListener('click', this.copyCommand);
      toolbar.addEventListener('mousedown', stopTerminalEvent);
      toolbar.addEventListener('pointerdown', stopTerminalEvent);
      // Native button activation and Tab keep their defaults, but cannot turn into shell input.
      toolbar.addEventListener('keydown', stopTerminalEvent);
      toolbar.addEventListener('keyup', stopTerminalEvent);
      toolbar.addEventListener('keypress', stopTerminalEvent);
      this.toolbar = toolbar;
      element.appendChild(toolbar);
    }
    this.hoverHost.setElement(element);
    // Keep feedback separate even in narrow panes; actions scroll within the remaining area.
    const cols = this.options.terminal.cols;
    element.style.setProperty(
      '--command-feedback-width',
      `${(100 * this.feedbackWidth()) / cols}%`,
    );
    this.updateToolbar();
    if (this.pendingFocus !== null && element.isConnected && element.style.display !== 'none') {
      const active = element.ownerDocument.activeElement;
      // A user who focused another control while awaiting xterm's render must not lose that focus.
      if (active === element.ownerDocument.body || this.toolbar?.contains(active)) {
        const button = this.buttons.get(this.pendingFocus);
        if (button && !button.disabled && this.representative) {
          button.focus({ preventScroll: true });
          // Restore only this horizontal viewport; scrollIntoView could move the terminal/page too.
          const toolbar = this.toolbar;
          if (toolbar) {
            if (button.offsetLeft < toolbar.scrollLeft) {
              toolbar.scrollLeft = button.offsetLeft;
            } else if (
              button.offsetLeft + button.offsetWidth >
              toolbar.scrollLeft + toolbar.clientWidth
            ) {
              toolbar.scrollLeft = button.offsetLeft + button.offsetWidth - toolbar.clientWidth;
            }
          }
        }
      }
      this.pendingFocus = null;
    }
  }

  private readonly copyCommand = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.disposed || !(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest('button');
    for (const [mode, button] of this.buttons) {
      if (button === target && !button.disabled) {
        void this.options.copyController.copy(mode);
      }
    }
  };

  private update(): void {
    if (this.disposed) {
      return;
    }
    this.updateToolbar();
    const state = this.options.copyController.getState();
    if (state.status === 'idle' || this.options.terminal.buffer.active.type !== 'normal') {
      this.clearIndicator();
      return;
    }
    if (!this.indicatorDecoration) {
      this.indicatorDecoration = this.options.terminal.registerDecoration({
        marker: this.options.entry.blockStartMarker,
        anchor: 'right',
        width: this.feedbackWidth(),
        height: 1,
        layer: 'top',
      });
      if (this.indicatorDecoration) {
        this.indicatorSubscriptions = [
          this.indicatorDecoration.onRender((element) => {
            if (this.disposed) {
              return;
            }
            element.classList.add('evermore-command-copy-feedback-decoration');
            if (this.indicator?.parentElement !== element) {
              this.indicator?.remove();
              this.indicator = element.ownerDocument.createElement('span');
              this.indicator.className = 'evermore-command-copy-feedback';
              this.indicator.setAttribute('role', 'status');
              element.appendChild(this.indicator);
            }
            this.updateIndicator();
          }),
          this.indicatorDecoration.onDispose(() => this.clearIndicator()),
        ];
      }
    }
    this.updateIndicator();
  }

  private updateToolbar(): void {
    if (!this.toolbar) {
      return;
    }
    this.toolbar.dataset.hovered = String(this.hovered);
    this.toolbar.hidden = !this.representative;
    const state = this.options.copyController.getState();
    for (const [mode, button] of this.buttons) {
      button.disabled = state.busy || (mode !== 'command' && !state.outputAvailable);
    }
  }

  private updateIndicator(): void {
    if (!this.indicator) {
      return;
    }
    const state = this.options.copyController.getState();
    const { symbol, label } = getPresentation(state);
    this.indicator.dataset.state = state.status;
    this.indicator.textContent = symbol;
    this.indicator.setAttribute('aria-label', label);
    this.indicator.title = label;
  }

  private feedbackWidth(): number {
    return Math.min(2, Math.max(1, this.options.terminal.cols - 1));
  }

  private focusedMode(): CommandCopyMode | null {
    for (const [mode, button] of this.buttons) {
      if (button.ownerDocument.activeElement === button) {
        return mode;
      }
    }
    return null;
  }

  private clearToolbar(): void {
    for (const subscription of this.toolbarSubscriptions.splice(0)) {
      subscription.dispose();
    }
    this.hoverHost.setElement(null);
    this.removeToolbar();
    const decoration = this.toolbarDecoration;
    this.toolbarDecoration = undefined;
    if (decoration && !decoration.isDisposed) {
      decoration.dispose();
    }
  }

  private removeToolbar(): void {
    this.toolbar?.removeEventListener('click', this.copyCommand);
    for (const type of ['mousedown', 'pointerdown', 'keydown', 'keyup', 'keypress']) {
      this.toolbar?.removeEventListener(type, stopTerminalEvent);
    }
    this.toolbar?.remove();
    this.toolbar = null;
    this.buttons.clear();
  }

  private clearIndicator(): void {
    for (const subscription of this.indicatorSubscriptions.splice(0)) {
      subscription.dispose();
    }
    this.indicator?.remove();
    this.indicator = null;
    const decoration = this.indicatorDecoration;
    this.indicatorDecoration = undefined;
    if (decoration && !decoration.isDisposed) {
      decoration.dispose();
    }
  }
}

function stopTerminalEvent(event: Event): void {
  event.stopPropagation();
}

function getPresentation(state: TerminalCommandCopyState): { symbol: string; label: string } {
  const subject =
    state.mode === 'output'
      ? 'output'
      : state.mode === 'command'
        ? 'command'
        : 'command and output';
  switch (state.status) {
    case 'copied':
      return { label: `Copied ${subject}`, symbol: '✓' };
    case 'error':
      return { label: `Copy ${subject} failed`, symbol: '!' };
    case 'idle':
      return { label: `Copy ${subject}`, symbol: '⧉' };
  }
}
