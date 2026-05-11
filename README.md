# Evermore

Evermore is a simple terminal workspace for developers, built with Electron and React.

## Features

- Workspace sidebar to manage and focus workspaces, tabs, and individual panes
- Split-pane terminal area with pane full-screen functionality to focus on a single process
- Persistent workspace and tab layout state backed by main-process PTY ownership
- SSH host discovery from `~/.ssh/config`, including `Include` expansion
- SSH host detail expansion showing resolved directives (via `ssh -G`)
- SSH host shortcuts that open terminal tabs with `ssh <alias>`
- SSH tunnel runtime state for hosts with `LocalForward`, `RemoteForward`, or `DynamicForward`
- Tunnel start/stop controls, status updates, and recent log snapshots

## Recommended Setup

There are several recommended setups for the shell and SSH configuration. While these are not
mandatory, they would enhance the user experience.

Open **Settings > Recommended setup** in Evermore to copy the optional OSC 7 shell snippet for cwd
tracking and SSH config snippet for tunnel reliability.
