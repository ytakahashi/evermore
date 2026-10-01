import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vite-plus/test';

const execFileAsync = promisify(execFile);
const vpBin = resolve('node_modules/.bin/vp');
// Oxlint reports codes as `plugin(rule)`; core ESLint rules use the `eslint` plugin name.
const architectureRuleIds = new Map([
  ['boundaries(dependencies)', 'boundaries/dependencies'],
  ['boundaries(no-unknown-dependencies)', 'boundaries/no-unknown-dependencies'],
  ['boundaries(no-unknown-files)', 'boundaries/no-unknown-files'],
  ['eslint(no-restricted-globals)', 'no-restricted-globals'],
]);

type OxlintJsonReport = { diagnostics: ReadonlyArray<{ code: string }> };

async function runLint(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(vpBin, ['lint', '--format', 'json', filePath]);
    return stdout;
  } catch (error: unknown) {
    // Oxlint exits non-zero whenever it reports an error, which is the expected outcome for the
    // rejection cases; the report is still on stdout.
    if (error instanceof Error && 'stdout' in error && typeof error.stdout === 'string') {
      return error.stdout;
    }
    throw error;
  }
}

const fixtureBaseName = '__architecture_fixture__';

/**
 * Makes a fixture path unique per lint run so concurrent test processes never overwrite or delete
 * each other's fixture. The token goes right after the base name: boundaries classifies test files
 * by the `.test.ts` suffix, and `.gitignore` matches `__architecture_fixture__.*`.
 */
function uniqueFixturePath(filePath: string): string {
  return filePath.replace(fixtureBaseName, `${fixtureBaseName}.${randomUUID()}`);
}

async function lintArchitectureRules(
  source: string,
  filePath: string,
): Promise<ReadonlyArray<string | null>> {
  // Oxlint has no lint-from-stdin API, and boundaries classifies files by path, so the fixture
  // must exist at its layer path while the CLI runs. A unique name isolates test runs from each
  // other, but other tools running at the same time (lint, typecheck, a dev watcher) can still see
  // the violating fixture until it is removed.
  const fixturePath = uniqueFixturePath(filePath);
  await writeFile(fixturePath, source);
  try {
    const report = JSON.parse(await runLint(fixturePath)) as OxlintJsonReport;
    return report.diagnostics.flatMap((diagnostic) => {
      const ruleId = architectureRuleIds.get(diagnostic.code);
      return ruleId === undefined ? [] : [ruleId];
    });
  } finally {
    await rm(fixturePath, { force: true });
  }
}

describe('architecture lint rules', () => {
  it.each([
    [
      'shared importing shared',
      "import type { Workspace } from './types';",
      'src/shared/__architecture_fixture__.ts',
    ],
    [
      'main importing shared',
      "import type { Workspace } from '../shared/types';",
      'src/main/__architecture_fixture__.ts',
    ],
    [
      'preload importing electron',
      "import type { IpcRenderer } from 'electron';",
      'src/preload/__architecture_fixture__.ts',
    ],
    [
      'preload importing a shared type',
      "import type { Api } from '../shared/api-types';",
      'src/preload/__architecture_fixture__.ts',
    ],
    [
      'renderer importing shared',
      "import type { Workspace } from '../../shared/types';",
      'src/renderer/src/__architecture_fixture__.ts',
    ],
    [
      'a colocated test importing a test dependency',
      "import { describe } from 'vitest';",
      'src/shared/__architecture_fixture__.test.ts',
    ],
  ])('allows %s', async (_label: string, source: string, filePath: string) => {
    // Given: an import permitted by the owning layer's dependency policy.

    // When: the repository lint configuration evaluates the source.
    const ruleIds = await lintArchitectureRules(source, filePath);

    // Then: no architecture rule rejects it.
    expect(ruleIds).toEqual([]);
  });

  it.each([
    [
      'an external dependency from shared',
      "import clsx from 'clsx';",
      'src/shared/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a Node built-in from shared',
      "import fs from 'node:fs';",
      'src/shared/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a browser global from shared',
      'window.location.href;',
      'src/shared/__architecture_fixture__.ts',
      'no-restricted-globals',
    ],
    [
      'renderer code from main',
      "import { App } from '../renderer/src/App';",
      'src/main/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a browser global from main',
      'document.title = "";',
      'src/main/__architecture_fixture__.ts',
      'no-restricted-globals',
    ],
    [
      'an unapproved external dependency from preload',
      "import { is } from '@electron-toolkit/utils';",
      'src/preload/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a shared runtime helper from preload',
      "import { DEFAULT_APP_SETTINGS } from '../shared/settings-defaults';",
      'src/preload/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a bare Node built-in from renderer',
      "import { Buffer } from 'buffer';",
      'src/renderer/src/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
    [
      'a dynamic main import from renderer',
      "void import('../../main/window-options');",
      'src/renderer/src/__architecture_fixture__.ts',
      'boundaries/dependencies',
    ],
  ])(
    'rejects %s',
    async (_label: string, source: string, filePath: string, expectedRuleId: string) => {
      // Given: a dependency forbidden by the importing layer's architecture.

      // When: the repository lint configuration evaluates the source.
      const ruleIds = await lintArchitectureRules(source, filePath);

      // Then: exactly the responsible rule reports it. Asserting the full list keeps the case
      // honest: a fixture that stopped resolving would report `no-unknown-dependencies` instead,
      // which must not be mistaken for the boundary rule this case is about.
      expect(ruleIds).toEqual([expectedRuleId]);
    },
  );
});
