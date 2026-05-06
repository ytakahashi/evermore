# AGENTS.md

## Project Overview

- Evermore is a simple terminal workspace for developers.
- The application is built with Electron and a React frontend.

Refer to [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

## Coding Style Guidelines

### Editing

- Do not revert or rewrite unrelated user changes.
- Keep changes scoped to the requested phase or step.

### TypeScript

- Strict mode is enabled (`"strict": true`).
- Use explicit types for function parameters and return values.
- Use `unknown` (not `any`) in `catch` blocks.
- If the error is inspected, narrow it with `instanceof Error` before reading error fields.
- If the error is intentionally ignored, bind it as `_error: unknown` and explain why in a comment.

### Electron / IPC

- Renderer code must not import Node-only APIs or `node-pty` directly.
- Main-process capabilities should be exposed to the renderer only through preload `window.api`.
- PTY processes are runtime-only state owned by the main process.
- `cwd` is a PTY creation input. Do not recreate a running PTY just because a pane cwd prop changes.

### Code Comments

- Add JSDoc to exported functions, classes, and hooks.
- Comments should explain intent, constraints, design decisions, or implementation background.
- Avoid comments that merely restate what the next line of code does.
- Add inline comments for non-obvious lifecycle, IPC, async, platform, or cleanup behavior where the
  reason would not be clear from the code alone.

### Testing

- Test files are colocated with source files.
- Test runner is Vitest (config: `vitest.config.ts`).
- Tests use explicit imports (`import { describe, it, expect } from 'vitest'`), not globals.
- Renderer component tests run in jsdom.
- Main-process unit tests should prefer pure classes and dependency injection.
- Do not require real Electron windows, real PTYs, or real xterm instances in unit tests; mock them.
- Use **Given / When / Then** style with explicit comment blocks to structure test cases for better
  readability.

## Implementation Checklist

After completing any code implementation task, ensure the following all pass:

```bash
pnpm run format    # Prettier check passes
pnpm run lint      # ESLint check passes
pnpm run typecheck # TypeScript type checks pass
pnpm run test      # All test cases pass
pnpm run build     # Production build succeeds
```
