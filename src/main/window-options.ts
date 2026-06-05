import type { BrowserWindowConstructorOptions } from 'electron';

interface CreateMainWindowOptionsInput {
  preloadPath: string;
  isDev: boolean;
  iconPath?: string;
  platform?: NodeJS.Platform;
}

/**
 * Builds the main BrowserWindow options with the renderer security invariants in one testable
 * place.
 */
export function createMainWindowOptions(
  options: CreateMainWindowOptionsInput,
): BrowserWindowConstructorOptions {
  const platform = options.platform ?? process.platform;

  return {
    width: 1024,
    height: 768,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 10 },
    ...(platform === 'linux' && options.iconPath ? { icon: options.iconPath } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: options.isDev,
    },
  };
}
