/* eslint-disable no-undef */
import { web } from './esbuild-configs/web.esbuild.js';
import { desktop } from './esbuild-configs/desktop.esbuild.js';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const modeArgIndex = process.argv.indexOf('--mode');
const mode = modeArgIndex !== -1 && process.argv[modeArgIndex + 1] ? process.argv[modeArgIndex + 1] : 'default';

(async () => {
    try {
        switch (mode.toLowerCase()) {
            case 'web':
                console.log(watch ? 'Watching' : 'Running' + ' web build...');
                await web(production, watch).catch(erm => {
                    console.error(erm);
                    process.exit(1);
                });
                break;
            case 'desktop':
                console.log(watch ? 'Watching' : 'Running' + ' desktop build...');
                await desktop(production, watch).catch(erm => {
                    console.error(erm);
                    process.exit(1);
                });
                break;
            case 'default':
                // Can't use watch while building both.
                if (watch) {
                    console.error('Cannot use flag --watch while building both desktop and web');
                }
                console.log('Running desktop build...');
                await desktop(production, false).catch(erm => {
                    console.error(erm);
                    process.exit(1);
                });
                console.log('Running web build...');
                await web(production, false).catch(erm => {
                    console.error(erm);
                    process.exit(1);
                });
                console.log('Build completed.');
                break;
            default:
                console.error(`Unknown mode: ${mode}`);
                process.exit(1);
        }
    } catch (erm) {
        console.error('Build failed:', erm);
        process.exit(1);
    }
})();
