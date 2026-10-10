// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import lm from '@lm/eslint-plugin';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/build-ladle/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/desktop/src-tauri/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      // Throwaway spike code (ROADMAP P0.2).
      'spikes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { '@lm': lm },
    rules: {
      '@lm/no-physical-direction': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    // `core` must stay pure (AGENTS.md §4.9): no platform, DOM or network APIs.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'fetch',
          'localStorage',
          'indexedDB',
          'navigator',
          'XMLHttpRequest',
        ].map((name) => ({
          name,
          message: '@lm/core is pure; inject platform capabilities instead.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: '@lm/core is pure; no Node built-ins.' },
            { group: ['react', 'react-dom'], message: '@lm/core has no UI.' },
          ],
        },
      ],
    },
  },
  {
    // Tests may assert on known-present values.
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    // CLI scripts may print.
    files: ['tooling/**/cli.js'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
