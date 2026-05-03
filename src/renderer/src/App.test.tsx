import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./components/terminal/TerminalView', () => ({
  TerminalView: () => <div>Terminal View</div>,
}));

describe('App', () => {
  it('renders the application shell', () => {
    // Given: the app can render without requiring a real terminal process.

    // When: the root app component is mounted.
    render(<App />);

    // Then: the primary scaffold regions are visible.
    expect(screen.getAllByText('evermore')).not.toHaveLength(0);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Terminal View')).toBeInTheDocument();
  });

  it('renders named sidebar navigation buttons', () => {
    // Given: the sidebar bottom navigation uses icon-only controls.

    // When: the root app component is mounted.
    render(<App />);

    // Then: each icon-only control exposes an accessible name.
    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
