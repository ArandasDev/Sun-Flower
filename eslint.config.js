import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'interfaces/dashboard/app/dist/'],
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
  {
    // The panel app is a separate TS project with its own tsconfig.
    files: ['interfaces/dashboard/app/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./interfaces/dashboard/app/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Use texto; a CSP e a revisão proíbem HTML bruto.',
        },
      ],
    },
  },
  prettier,
);
