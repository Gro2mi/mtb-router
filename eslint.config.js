import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'src/paraglide',
      'public/vendor',
      'test-results',
      'playwright-report',
      'coverage',
      '.inlang',
    ],
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        svelteConfig: './svelte.config.js',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
