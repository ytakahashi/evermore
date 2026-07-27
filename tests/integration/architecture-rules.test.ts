import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });
const architectureRuleIds = new Set([
  'boundaries/dependencies',
  'boundaries/no-unknown-dependencies',
  'boundaries/no-unknown-files',
  'no-restricted-globals',
]);

async function lintArchitectureRules(
  source: string,
  filePath: string,
): Promise<ReadonlyArray<string | null>> {
  const results = await eslint.lintText(source, { filePath });
  return results.flatMap((result) =>
    result.messages
      .map((message) => message.ruleId)
      .filter((ruleId) => ruleId !== null && architectureRuleIds.has(ruleId)),
  );
}

describe('architecture ESLint rules', () => {
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

    // When: the repository ESLint configuration evaluates the source.
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

      // When: the repository ESLint configuration evaluates the source.
      const ruleIds = await lintArchitectureRules(source, filePath);

      // Then: exactly the responsible rule reports it. Asserting the full list keeps the case
      // honest: a fixture that stopped resolving would report `no-unknown-dependencies` instead,
      // which must not be mistaken for the boundary rule this case is about.
      expect(ruleIds).toEqual([expectedRuleId]);
    },
  );
});
