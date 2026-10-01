import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

// Vite+ reads this file for `vp lint`, `vp fmt`, and `vp test` only. The app itself is built and
// served by electron-vite from `electron.vite.config.ts`, so `plugins` and `resolve` here exist for
// the test runner and must mirror the renderer settings there.

const architectureElements = [
  { type: 'main', pattern: 'src/main', partialMatch: false },
  { type: 'preload', pattern: 'src/preload', partialMatch: false },
  { type: 'renderer', pattern: 'src/renderer', partialMatch: false },
  { type: 'shared', pattern: 'src/shared', partialMatch: false },
];

const architectureDependencyRules = [
  {
    from: { element: { type: 'shared' } },
    allow: { to: { element: { type: 'shared' } } },
  },
  {
    from: { element: { type: 'main' } },
    allow: { to: { element: { type: ['main', 'shared'] } } },
  },
  {
    from: { element: { type: 'preload' } },
    allow: { to: { element: { type: 'preload' } } },
  },
  {
    from: { element: { type: 'preload' } },
    allow: {
      to: { element: { type: 'shared' } },
      dependency: { kind: 'type' },
    },
  },
  {
    from: { element: { type: 'preload' } },
    allow: {
      to: { element: { type: 'shared', fileInternalPath: 'ipc-channels.ts' } },
      dependency: { kind: 'value' },
    },
  },
  {
    from: { element: { type: 'renderer' } },
    allow: { to: { element: { type: ['renderer', 'shared'] } } },
  },
  {
    from: { element: { type: 'main' } },
    allow: { to: { module: { origin: 'core' } } },
  },
  {
    from: { element: { type: 'main' } },
    allow: {
      to: {
        module: {
          origin: 'external',
          source: [
            '@electron-toolkit/utils',
            'electron',
            'electron-store',
            'node-pty',
            'ssh-config',
          ],
        },
      },
    },
  },
  {
    from: { element: { type: 'preload' } },
    allow: { to: { module: { origin: 'external', source: 'electron' } } },
  },
  {
    from: { element: { type: 'renderer' } },
    allow: {
      to: {
        module: {
          origin: 'external',
          source: [
            '@xterm/addon-fit',
            '@xterm/addon-unicode11',
            '@xterm/addon-web-links',
            '@xterm/xterm',
            'clsx',
            'lucide-react',
            'react',
            'react-dom',
            'tailwind-merge',
            'zustand',
          ],
        },
      },
    },
  },
  // Tests exercise their owning layer and may use test-only packages or cross architectural seams.
  {
    from: { file: { categories: 'test' } },
    allow: { to: { module: { origin: ['local', 'external', 'core'] } } },
  },
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
    },
  },
  lint: {
    plugins: ['oxc', 'typescript', 'unicorn', 'react'],
    jsPlugins: [
      { name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' },
      // Runs as an Oxlint JS plugin. `tests/integration/architecture-rules.test.ts` guards that the
      // policies below still fire, since JS plugin support in Oxlint is not yet stable.
      'eslint-plugin-boundaries',
    ],
    categories: {
      correctness: 'warn',
    },
    env: {
      builtin: true,
      es2024: true,
      node: true,
    },
    // Oxlint does not accept `settings` inside `overrides`; `boundaries/include` scopes the
    // boundaries settings to `src/` instead.
    settings: {
      react: {
        version: '19.0',
      },
      'boundaries/elements': architectureElements,
      'boundaries/files': [
        {
          category: 'test',
          pattern: [
            'src/**/*.test.{ts,tsx}',
            'src/**/test-utils/**/*.{ts,tsx}',
            'src/**/__test-utils__/**/*.{ts,tsx}',
          ],
        },
      ],
      'boundaries/include': ['src/**/*.{ts,tsx}'],
      'import/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.node.json', './tsconfig.web.json'],
        },
      },
    },
    ignorePatterns: ['**/node_modules', '**/dist', '**/out'],
    // Every linted file is TypeScript, so rules that the TypeScript compiler already enforces
    // (e.g. `no-undef`, `no-redeclare`) are intentionally absent.
    rules: {
      // eslint:recommended
      'for-direction': 'error',
      'no-async-promise-executor': 'error',
      'no-case-declarations': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': 'error',
      'no-constant-binary-expression': 'error',
      'no-constant-condition': 'error',
      'no-control-regex': 'error',
      'no-debugger': 'error',
      'no-delete-var': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'error',
      'no-empty-character-class': 'error',
      'no-empty-pattern': 'error',
      'no-empty-static-block': 'error',
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'error',
      'no-fallthrough': 'error',
      'no-global-assign': 'error',
      'no-invalid-regexp': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-misleading-character-class': 'error',
      'no-nonoctal-decimal-escape': 'error',
      'no-prototype-builtins': 'error',
      'no-regex-spaces': 'error',
      'no-self-assign': 'error',
      'no-shadow-restricted-names': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unused-labels': 'error',
      'no-unused-private-class-members': 'error',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-useless-backreference': 'error',
      'no-useless-catch': 'error',
      'no-useless-escape': 'error',
      'require-yield': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'no-array-constructor': 'error',
      'no-unused-expressions': 'error',
      'no-empty-function': ['error', { allow: ['arrowFunctions'] }],

      // typescript-eslint recommended
      'typescript/ban-ts-comment': 'error',
      'typescript/no-duplicate-enum-values': 'error',
      'typescript/no-empty-object-type': 'error',
      'typescript/no-explicit-any': 'warn',
      'typescript/no-extra-non-null-assertion': 'error',
      'typescript/no-misused-new': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-non-null-asserted-optional-chain': 'error',
      'typescript/no-require-imports': 'error',
      'typescript/no-this-alias': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',
      'typescript/no-unsafe-declaration-merging': 'error',
      'typescript/no-unsafe-function-type': 'error',
      'typescript/no-wrapper-object-types': 'error',
      'typescript/prefer-as-const': 'error',
      'typescript/prefer-namespace-keyword': 'error',
      'typescript/triple-slash-reference': 'error',
      'typescript/explicit-function-return-type': ['error', { allowExpressions: true }],

      // eslint-plugin-react recommended, with the automatic JSX runtime
      'react/display-name': 'error',
      'react/jsx-key': 'error',
      'react/jsx-no-comment-textnodes': 'error',
      'react/jsx-no-duplicate-props': 'error',
      'react/jsx-no-target-blank': 'error',
      'react/jsx-no-undef': 'error',
      'react/no-children-prop': 'error',
      'react/no-danger-with-children': 'error',
      'react/no-direct-mutation-state': 'error',
      'react/no-find-dom-node': 'error',
      'react/no-is-mounted': 'error',
      'react/no-render-return-value': 'error',
      'react/no-string-refs': 'error',
      'react/no-unescaped-entities': 'error',
      'react/no-unknown-property': 'error',
      'react/require-render-return': 'error',
      'react/react-in-jsx-scope': 'off',

      // eslint-plugin-react-hooks recommended
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'warn',
      'react/static-components': 'error',
      'react/use-memo': 'error',
      'react/preserve-manual-memoization': 'error',
      'react/incompatible-library': 'warn',
      'react/immutability': 'error',
      'react/globals': 'error',
      'react/refs': 'error',
      'react/set-state-in-effect': 'error',
      'react/error-boundaries': 'error',
      'react/purity': 'error',
      'react/set-state-in-render': 'error',
      'react/unsupported-syntax': 'warn',

      // eslint-plugin-react-refresh
      'react/only-export-components': ['warn', { allowConstantExport: true }],

      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      // ARCHITECTURE.md is enforced against resolved import targets. The default-deny policy makes
      // a new layer or runtime dependency fail lint until its process compatibility is reviewed
      // here.
      {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
          'boundaries/dependencies': [
            'error',
            {
              default: 'disallow',
              checkAllOrigins: true,
              checkUnknownLocals: true,
              checkInternals: true,
              policies: architectureDependencyRules,
            },
          ],
          'boundaries/no-unknown-dependencies': 'error',
          'boundaries/no-unknown-files': 'error',
        },
      },
      {
        files: ['src/shared/**/*.{ts,tsx}'],
        rules: {
          'no-restricted-globals': [
            'error',
            'Buffer',
            'XMLHttpRequest',
            '__dirname',
            '__filename',
            'document',
            'fetch',
            'localStorage',
            'location',
            'module',
            'navigator',
            'process',
            'require',
            'sessionStorage',
            'window',
          ],
        },
      },
      // `window` is safe to restrict here: main refers to a `BrowserWindow` through parameters and
      // locals named `window`, which this rule does not touch.
      {
        files: ['src/main/**/*.{ts,tsx}'],
        rules: {
          'no-restricted-globals': [
            'error',
            'XMLHttpRequest',
            'document',
            'fetch',
            'localStorage',
            'navigator',
            'sessionStorage',
            'window',
          ],
        },
      },
      {
        files: ['src/preload/**/*.{ts,tsx}', 'src/renderer/**/*.{ts,tsx}'],
        rules: {
          'no-restricted-globals': [
            'error',
            'Buffer',
            '__dirname',
            '__filename',
            'module',
            'process',
            'require',
          ],
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    semi: true,
    singleQuote: true,
    trailingComma: 'all',
    bracketSpacing: true,
    endOfLine: 'lf',
    proseWrap: 'always',
    sortPackageJson: false,
    ignorePatterns: ['out', 'dist', 'node_modules', 'pnpm-lock.yaml', '.vscode', '.claude'],
  },
  test: {
    css: true,
    environment: 'jsdom',
    include: [
      'build/**/*.test.ts',
      'src/{main,renderer/src,shared}/**/*.test.{ts,tsx}',
      'tests/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup.ts'],
  },
});
