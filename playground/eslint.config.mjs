import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default tseslint.config(
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
        ignores: [
            'out',
            'playground/**',
            '**/vscode*.d.ts',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    {
        plugins: {
            '@stylistic': stylistic,
        },
        rules: {
            'curly': 'off',
            'no-control-regex': 'off',
            '@stylistic/semi': ['warn', 'always'],
            '@stylistic/indent': ['error', 4],
            '@stylistic/comma-dangle': ['warn', 'always-multiline'],
            '@stylistic/eol-last': ['warn', 'always'],
            '@stylistic/no-extra-parens': ['warn', 'all'],
            '@stylistic/no-trailing-spaces': ['warn', { 'ignoreComments': true }],
            '@stylistic/quotes': ['error', 'single', { 'avoidEscape': true }],
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    'selector': 'import',
                    'format': ['camelCase', 'PascalCase'],
                },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    'argsIgnorePattern': '^_',
                },
            ],
        },
    },
    {
        files: ['**/*.{js,mjs,cjs,ts}'],
        languageOptions: { globals: globals.node },
    },
);
