import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

function renderMenu(overrides: Partial<Parameters<typeof ContextMenu>[0]> = {}): {
  onClose: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
} {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const items: ContextMenuItem[] = [
    { type: 'action', id: 'enabled', label: 'Enabled', onSelect },
    { type: 'action', id: 'disabled', label: 'Disabled', disabled: true, onSelect: vi.fn() },
    { type: 'separator' },
    { type: 'label', label: 'Group' },
  ];

  render(
    <ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={onClose} {...overrides} />,
  );
  return { onClose, onSelect };
}

describe('ContextMenu', () => {
  it('invokes the action and closes when an enabled item is clicked', () => {
    // Given: a menu with an enabled action.
    const { onClose, onSelect } = renderMenu();

    // When: the enabled item is clicked.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enabled' }));

    // Then: the action runs and the menu is asked to close.
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders disabled actions as non-interactive', () => {
    // Given: a menu containing a disabled action.
    renderMenu();

    // Then: the disabled item is exposed as a disabled control.
    expect(screen.getByRole('menuitem', { name: 'Disabled' })).toBeDisabled();
  });

  it('closes on Escape', () => {
    // Given: an open menu.
    const { onClose } = renderMenu();

    // When: Escape is pressed inside the menu.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    // Then: the menu is asked to close.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on an outside pointer-down', () => {
    // Given: an open menu.
    const { onClose } = renderMenu();

    // When: a pointer-down lands outside the menu.
    fireEvent.pointerDown(document.body);

    // Then: the menu is asked to close.
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('reflects an action item title on the underlying button', () => {
    // Given: a disabled action carrying a reason via `title`.
    const items: ContextMenuItem[] = [
      {
        type: 'action',
        id: 'disabled-with-reason',
        label: 'Create Tab from Pane',
        disabled: true,
        title: 'At least two panes are required',
        onSelect: vi.fn(),
      },
    ];
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={vi.fn()} />);

    // Then: the button surfaces the reason as its title attribute.
    expect(screen.getByRole('menuitem', { name: 'Create Tab from Pane' })).toHaveAttribute(
      'title',
      'At least two panes are required',
    );
  });

  it('renders a menu made entirely of disabled actions', () => {
    // Given: every action item is disabled (callers that skip `hasActionableItem` rely on this).
    const items: ContextMenuItem[] = [
      {
        type: 'action',
        id: 'only-action',
        label: 'Create Tab from Pane',
        disabled: true,
        onSelect: vi.fn(),
      },
    ];
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={vi.fn()} />);

    // Then: the menu still renders the disabled item instead of being suppressed.
    expect(screen.getByRole('menuitem', { name: 'Create Tab from Pane' })).toBeDisabled();
  });

  it('does not invoke a disabled action on click', () => {
    // Given: a disabled action item.
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      { type: 'action', id: 'disabled', label: 'Disabled', disabled: true, onSelect },
    ];
    render(<ContextMenu position={{ x: 10, y: 10 }} items={items} onClose={vi.fn()} />);

    // When: the disabled item is clicked.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disabled' }));

    // Then: the action never runs.
    expect(onSelect).not.toHaveBeenCalled();
  });
});
