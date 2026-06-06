import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { createRendererCsp, createRendererCspPlugin } from './renderer-csp';

type RendererHtmlTransform = (
  html: string,
  context: { filename: string; path: string },
) => Promise<string> | string;

describe('createRendererCsp', () => {
  it('creates a production policy with explicit deny directives', () => {
    // Given: the production renderer mode.
    const mode = 'production';

    // When: the policy is generated.
    const csp = createRendererCsp(mode);

    // Then: risky browser capabilities are explicitly disabled.
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("media-src 'none'");
  });

  it('keeps production connections limited to self', () => {
    // Given: the production renderer mode.
    const mode = 'production';

    // When: the policy is generated.
    const csp = createRendererCsp(mode);

    // Then: Vite development websocket origins are absent.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('ws://localhost:*');
    expect(csp).not.toContain('ws://127.0.0.1:*');
  });

  it('allows Vite development websocket connections', () => {
    // Given: the development renderer mode.
    const mode = 'development';

    // When: the policy is generated.
    const csp = createRendererCsp(mode);

    // Then: local websocket origins are allowed for HMR.
    expect(csp).toContain("connect-src 'self' ws://localhost:* ws://127.0.0.1:*");
  });

  it('allows development inline scripts for React Refresh only outside production', () => {
    // Given: both renderer modes.
    const developmentCsp = createRendererCsp('development');
    const productionCsp = createRendererCsp('production');

    // When / Then: dev can run Vite's injected React Refresh bootstrap, while prod cannot.
    expect(developmentCsp).toContain("script-src 'self' 'unsafe-inline'");
    expect(productionCsp).toContain("script-src 'self'");
    expect(productionCsp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('generates a single-line policy suitable for a meta tag', () => {
    // Given: either renderer mode.
    const mode = 'production';

    // When: the policy is generated.
    const csp = createRendererCsp(mode);

    // Then: it does not introduce whitespace that would make the HTML attribute hard to read.
    expect(csp).not.toContain('\n');
  });

  it('injects the production policy into the renderer HTML template', async () => {
    // Given: the real renderer HTML template and the production CSP plugin.
    const filename = resolve('src/renderer/index.html');
    const indexHtml = readFileSync(filename, 'utf8');
    const plugin = createRendererCspPlugin('production');
    const transformIndexHtml = plugin.transformIndexHtml;

    if (typeof transformIndexHtml !== 'function') {
      throw new Error('Expected renderer CSP plugin to provide transformIndexHtml');
    }

    // When: Vite applies the plugin to the renderer HTML.
    const transformRendererHtml = transformIndexHtml as RendererHtmlTransform;
    const transformedHtml = await transformRendererHtml(indexHtml, {
      filename,
      path: '/index.html',
    });

    // Then: the template placeholder contract still matches the plugin replacement.
    expect(transformedHtml).toContain(`content="${createRendererCsp('production')}"`);
  });
});
