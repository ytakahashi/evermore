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

For cwd tracking, add the Evermore OSC 7 snippet below to your shell startup file so terminal panes
can keep their current directory in sync.

Example (zsh):

```sh
function _emit_osc7() {
  local pwd_url="file://${HOST}${PWD//[^a-zA-Z0-9\/._-]/%XX}"
  printf '\033]7;%s\033\\' "$pwd_url"
}
chpwd_functions+=(_emit_osc7)
_emit_osc7
```

For SSH tunnels, following settings are prefereds.

Example (SSH config):

```sshconfig
Host *
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
```

The first two settings make ssh exit within ~90 seconds of a dropped connection, so Evermore
reflects disconnects quickly. ExitOnForwardFailure makes ssh exit immediately when a forward fails
to bind, surfacing port conflicts without waiting for the startup grace.
