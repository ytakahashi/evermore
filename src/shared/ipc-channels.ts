export const IPC = {
  // PTY (renderer -> main: invoke / main -> renderer: send)
  PTY_CREATE: 'pty:create',
  PTY_WRITE: 'pty:write',
  PTY_RESIZE: 'pty:resize',
  PTY_DISPOSE: 'pty:dispose',
  PTY_DATA: 'pty:data', // main -> renderer
  PTY_EXIT: 'pty:exit', // main -> renderer

  // Workspace
  WS_LIST: 'workspace:list',
  WS_GET: 'workspace:get',
  WS_CREATE: 'workspace:create',
  WS_UPDATE: 'workspace:update',
  WS_DELETE: 'workspace:delete',
  WS_SET_ACTIVE_ID: 'workspace:set-active-id',

  // SSH
  SSH_LIST_HOSTS: 'ssh:list-hosts',
  SSH_RESOLVE: 'ssh:resolve', // ssh -G wrapper
  SSH_CONFIG_CHANGED: 'ssh:config-changed', // main -> renderer

  // Tunnel
  TUNNEL_LIST: 'tunnel:list',
  TUNNEL_START: 'tunnel:start',
  TUNNEL_STOP: 'tunnel:stop',
  TUNNEL_LOGS: 'tunnel:logs',
  TUNNEL_STATUS_CHANGED: 'tunnel:status-changed', // main -> renderer
  TUNNEL_LOG: 'tunnel:log', // main -> renderer

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
} as const;
