import { defineConfig } from 'eslint/config';
import tseslint from '@electron-toolkit/eslint-config-ts';
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import eslintPluginReact from 'eslint-plugin-react';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh';

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

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  {
    settings: {
      react: {
        version: '19.0',
      },
    },
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh,
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // ARCHITECTURE.md is enforced against resolved import targets. The default-deny policy makes a
  // new layer or runtime dependency fail lint until its process compatibility is reviewed here.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
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
    files: ['src/preload/**/*.{ts,tsx}'],
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
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
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
  eslintConfigPrettier,
);
