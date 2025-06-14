import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import eslintPluginAstro from 'eslint-plugin-astro';

export default defineConfig([
    js.configs.recommended,
    ...eslintPluginAstro.configs.recommended,
    globalIgnores([
        '.astro',
    ]),
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            }
        },
        rules: {
            'no-console': 'warn',
            'semi': ['error', 'always']
            // Add any additional rules specific to your project here
        }
    },
]);