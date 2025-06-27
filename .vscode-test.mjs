import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    label: 'desktopUnitTest',
    files: 'out/test/**/*.test.js',
    workspaceFolder: './test-playground',
    coverage: {
        include: ['src/**/*.ts'],
        exclude: ['src/test/**/*.test.ts', 'src/test/suite/index.ts'],
        output: './coverage',
    },
});
