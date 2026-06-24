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
});
