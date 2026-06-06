import { describe, expect, it } from 'vitest';
import { createMainWindowOptions } from './window-options';

describe('createMainWindowOptions', () => {
  it('uses sandboxed, isolated renderer preferences in production', () => {
    // Given: production window inputs.
    const preloadPath = '/app/out/preload/index.cjs';

    // When: BrowserWindow options are created.
    const options = createMainWindowOptions({
      preloadPath,
      isDev: false,
      platform: 'darwin',
      iconPath: '/app/resources/icon.png',
    });

    // Then: the renderer process is sandboxed and does not expose production DevTools.
    expect(options.webPreferences).toEqual({
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: false,
    });
    expect(options).not.toHaveProperty('icon');
  });

  it('keeps DevTools available during development', () => {
    // Given: development window inputs.
    const preloadPath = '/app/out/preload/index.cjs';

    // When: BrowserWindow options are created.
    const options = createMainWindowOptions({
      preloadPath,
      isDev: true,
      platform: 'darwin',
    });

    // Then: the security flags stay fixed while DevTools remain available.
    expect(options.webPreferences?.sandbox).toBe(true);
    expect(options.webPreferences?.devTools).toBe(true);
  });

  it('only attaches the icon path for Linux windows', () => {
    // Given: Linux window inputs where Electron needs an explicit icon.
    const iconPath = '/app/resources/icon.png';

    // When: BrowserWindow options are created.
    const options = createMainWindowOptions({
      preloadPath: '/app/out/preload/index.cjs',
      isDev: false,
      platform: 'linux',
      iconPath,
    });

    // Then: the icon is preserved for the platform-specific BrowserWindow option.
    expect(options.icon).toBe(iconPath);
  });
});
