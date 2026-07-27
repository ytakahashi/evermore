# AGENTS.md

## Project Overview

Evermore is a simple terminal workspace for developers, built with Electron and a React frontend.

The load-bearing constraints in this repository are the `main` / `preload` / `renderer` process
boundaries, the layer dependency rules, and the IPC contract. [ARCHITECTURE.md](./ARCHITECTURE.md)
describes the details — read it before changing anything that crosses those boundaries.

## Environment Notes

- Use pnpm. `postinstall` runs `electron-builder install-app-deps`. Installing with npm or yarn
  still typechecks, but PTY creation fails at runtime.
- `pnpm run dev` opens a GUI window and does not exit. Do not use it to verify a change.
- The e2e tier skips itself when the host lacks the real dependency it drives. A green
  `pnpm run test` therefore does not guarantee those suites ran.

## Conventions

Compiler and linter settings already enforce the mechanical rules. The conventions below are the
ones no tool checks.

### Error handling

- If the error is inspected, narrow it with `instanceof Error` before reading error fields.
- If the error is intentionally ignored, bind it as `_error: unknown` and explain why in a comment.

### Code Comments

- Add JSDoc to exported functions, classes, and hooks.
- Comments should explain intent, constraints, design decisions, or implementation background.
- Avoid comments that merely restate what the next line of code does.
- Add inline comments for non-obvious lifecycle, IPC, async, platform, or cleanup behavior where the
  reason would not be clear from the code alone.

### Testing

- Test tier structure (unit / integration / e2e), directory layout, runner configuration, and
  architectural invariants are documented in [ARCHITECTURE.md](./ARCHITECTURE.md#testing).
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
