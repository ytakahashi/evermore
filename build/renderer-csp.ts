import type { Plugin } from 'vite';

type RendererCspMode = 'development' | 'production';

const CSP_PLACEHOLDER = '__EVERMORE_CSP__';

const COMMON_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  // worker-src is disabled: this app does not use Web/Service Workers.
  // Loosen this if a future dependency (e.g. a code editor) needs them.
  "worker-src 'none'",
  "media-src 'none'",
] as const;

/**
 * Returns the renderer Content Security Policy for the requested runtime mode.
 */
export function createRendererCsp(mode: RendererCspMode): string {
  const scriptSrc =
    mode === 'development' ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const connectSrc =
    mode === 'development'
      ? "connect-src 'self' ws://localhost:* ws://127.0.0.1:*"
      : "connect-src 'self'";

  return [...COMMON_DIRECTIVES, scriptSrc, connectSrc].join('; ');
}

/**
 * Injects the mode-specific renderer CSP into `src/renderer/index.html`.
 */
export function createRendererCspPlugin(mode: RendererCspMode): Plugin {
  return {
    name: 'evermore-renderer-csp',
    transformIndexHtml(html: string): string {
      return html.replace(CSP_PLACEHOLDER, createRendererCsp(mode));
    },
  };
}
