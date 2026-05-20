# Evermore

Evermore is a smart terminal workspace that gives you an at-a-glance view of the state of your
terminals and connections.

## Features

### Core Features

Even without any shell configuration, Evermore provides a highly informative workspace:

- **Persistent Workspace Layouts**: The sidebar workspace, tab structure, and split-pane terminal
  layouts are persisted across sessions.
- **Pane Status Indicators**: Sidebar lists reflect whether a terminal pane is currently `running`
  or `idle`, using system-level process monitoring.
- **Active Process & Command Labels**: Sidebar pane items display the name of the active foreground
  program (e.g., `node`, `ssh`) or the last command line inferred from keystrokes.
- **SSH Config & Tunnel Management**:
  - Displays host shortcuts discovered from `~/.ssh/config`.
  - Shows resolved connection details (via `ssh -G`) and opens a terminal with one click.
  - Starts and stops SSH tunnels (LocalForward / RemoteForward / DynamicForward) with real-time
    port-forwarding state.

### Shell-Integrated Features (Zsh)

Zsh shell integration gives the workspace UI shell-level accuracy and responsiveness:

- **Auto-Injection**: Enabled by default; starting a Zsh pane automatically sets up integration.
- **Real-Time Directory Sync**: The pane's cwd updates instantly as you change directories.
- **Exact Command & Alias Labels**: Pane labels in the sidebar display the exact command line you
  typed (such as `pnpm run dev`), rather than generic process names (such as `node`).

## Recommended Setup

- **Zsh Auto-Injection**: Enabled by default. You can toggle this behavior under **Settings >
  Advanced features**.
- **SSH Config (Tunnel Reliability)**: Open **Settings > Recommended setup** to view and copy
  recommended SSH options (such as keep-alives) that keep background port-forwarding tunnels
  reliable.
- **Manual Shell Setup (Fallback)**: Copy the manual shell integration snippet from **Settings >
  Recommended setup** if you run custom shells or subshells, or prefer to configure shell
  integration manually.
