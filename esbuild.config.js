/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
    const ctx = await esbuild.context({
        entryPoints: ['src/web/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'browser',
        outdir: 'out/web',
        external: ['vscode'],
        logLevel: 'warning',
        // Node.js global to browser globalThis
        define: {
            global: 'globalThis',
        },
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(erm => {
    console.error(erm);
    process.exit(1);
});
