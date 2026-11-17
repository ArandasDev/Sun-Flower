import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Modules reach the Core only through shared contracts and the ModuleContext.
    files: ['modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'discord.js',
              message: 'Modules must not import discord.js; use the ModuleContext contracts.',
            },
          ],
          patterns: [
            {
              group: ['discord.js/*'],
              message: 'Modules must not import discord.js; use the ModuleContext contracts.',
            },
            {
              group: ['**/core', '**/core/**', 'core', 'core/**'],
              message: 'Modules must not import from core/; use the ModuleContext.',
            },
            {
              group: ['**/interfaces', '**/interfaces/**', 'interfaces', 'interfaces/**'],
              message: 'Modules must not import from interfaces/.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
