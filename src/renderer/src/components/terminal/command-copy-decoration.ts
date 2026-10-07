import type { IDecoration, IDisposable, Terminal } from '@xterm/xterm';
import type { TerminalCommandHistoryEntry } from './command-history';
import type { TerminalCommandCopyController, TerminalCommandCopyState } from './command-copy';

export interface TerminalCommandCopyDecorationOptions {
  terminal: Terminal;
  entry: TerminalCommandHistoryEntry;
  copyController: TerminalCommandCopyController;
  onDisposed?: () => void;
}

/** Renders the existing copy action and a separate feedback indicator using shared copy state. */
export function createTerminalCommandCopyDecoration(
  options: TerminalCommandCopyDecorationOptions,
): IDisposable | null {
  if (options.entry.promptMarker.isDisposed || options.entry.blockStartMarker.isDisposed) {
    return null;
  }
  return new CommandCopyDecorationController(options);
}

class CommandCopyDecorationController implements IDisposable {
  private buttonDecoration: IDecoration | undefined;
  private buttonDisposables: IDisposable[] = [];
  private indicatorDecoration: IDecoration | undefined;
  private indicatorDisposables: IDisposable[] = [];
  private button: HTMLButtonElement | null = null;
  private indicator: HTMLSpanElement | null = null;
  private readonly stateDisposable: IDisposable;
  private disposed = false;

  public constructor(private readonly options: TerminalCommandCopyDecorationOptions) {
    if (options.copyController.getState().outputAvailable) {
      this.buttonDecoration = options.terminal.registerDecoration({
        marker: options.entry.promptMarker,
        anchor: 'right',
        width: 2,
        height: 1,
        layer: 'top',
      });
      if (this.buttonDecoration) {
        this.buttonDisposables = [
          this.buttonDecoration.onRender((element) => {
            this.renderButton(element);
          }),
          this.buttonDecoration.onDispose(() => {
            this.dispose();
          }),
        ];
      }
    }
    this.stateDisposable = options.copyController.onStateChange(() => {
      this.update();
    });
    this.update();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stateDisposable.dispose();
    this.clearButton();
    this.clearIndicator();
    this.options.onDisposed?.();
  }

  private renderButton(element: HTMLElement): void {
    if (this.disposed) {
      return;
    }
    element.classList.add('evermore-command-copy-decoration');
    if (this.button?.parentElement !== element) {
      this.removeButton();
      const button = element.ownerDocument.createElement('button');
      button.className = 'evermore-command-copy-button';
      button.type = 'button';
      button.tabIndex = 0;
      button.addEventListener('mousedown', stopTerminalPointerEvent);
      button.addEventListener('click', this.copyCommand);
      this.button = button;
      element.appendChild(button);
    }
    this.updateButton(this.options.copyController.getState());
  }

  private readonly copyCommand = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.disposed) {
      void this.options.copyController.copy('command-and-output');
    }
  };

  private update(): void {
    if (this.disposed) {
      return;
    }
    const state = this.options.copyController.getState();
    if (!state.outputAvailable) {
      this.clearButton();
    }
    this.updateButton(state);
    if (state.status === 'idle') {
      this.clearIndicator();
      return;
    }
    if (!this.indicatorDecoration) {
      this.indicatorDecoration = this.options.terminal.registerDecoration({
        marker: this.options.entry.blockStartMarker,
        anchor: 'right',
        width: 2,
        height: 1,
        layer: 'top',
      });
      if (this.indicatorDecoration) {
        this.indicatorDisposables = [
          this.indicatorDecoration.onRender((element) => {
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
          this.indicatorDecoration.onDispose(() => {
            this.clearIndicator();
          }),
        ];
      }
    }
    this.updateIndicator();
  }

  private updateButton(state: TerminalCommandCopyState): void {
    if (!this.button) {
      return;
    }
    this.button.disabled = state.busy;
    // The action always copies both parts; only the independent indicator describes past results.
    this.button.textContent = '⧉';
    this.button.setAttribute('aria-label', 'Copy command and output');
    this.button.title = 'Copy command and output';
    // The independent indicator takes this cell while feedback is visible on a one-line prompt.
    this.button.hidden =
      state.status !== 'idle' &&
      this.options.entry.blockStartMarker.line === this.options.entry.promptMarker.line;
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

  private clearButton(): void {
    for (const disposable of this.buttonDisposables.splice(0)) {
      disposable.dispose();
    }
    this.removeButton();
    const decoration = this.buttonDecoration;
    this.buttonDecoration = undefined;
    if (decoration && !decoration.isDisposed) {
      decoration.dispose();
    }
  }

  private removeButton(): void {
    this.button?.removeEventListener('mousedown', stopTerminalPointerEvent);
    this.button?.removeEventListener('click', this.copyCommand);
    this.button?.remove();
    this.button = null;
  }

  private clearIndicator(): void {
    for (const disposable of this.indicatorDisposables.splice(0)) {
      disposable.dispose();
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

function stopTerminalPointerEvent(event: MouseEvent): void {
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
