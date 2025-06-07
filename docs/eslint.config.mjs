export default {
    env: {
        browser: true,
        es2021: true
    },
    extends: [
        'eslint:recommended',
        'plugin:astro/recommended'
    ],
    parser: 'astro-eslint-parser',
    parserOptions: {
        parser: '@typescript-eslint/parser',
        ecmaVersion: 2021,
        sourceType: 'module'
    },
    settings: {
        astro: {
            version: 'latest'
        }
    },
    rules: {
        'no-console': 'warn',
        'semi': ['error', 'always']
        // Add any additional rules specific to your project here
    }
};