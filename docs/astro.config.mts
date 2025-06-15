// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
    site: 'https://pasu4.github.io/neuropilot',
    base: '/neuropilot',
    integrations: [
        starlight({
            favicon: '/heart-pink.svg',
            customCss: [
                './src/styles/icons.css'
            ],
            head: [
                {
                    tag: 'link',
                    attrs: {
                        rel: 'icon',
                        href: '/neuropilot/heart-pink.svg'
                    }
                }
            ],
            title: 'NeuroPilot Docs',
            logo: {
                dark: './src/assets/evilpilot.svg',
                light: './src/assets/neuropilot.svg'
            },
            social: [
                {
                    icon: 'vscode',
                    label: 'NeuroPilot listing on Visual Studio Marketplace',
                    href: 'https://marketplace.visualstudio.com/items?itemName=Pasu4.neuropilot',
                },
                {
                    icon: 'github',
                    label: 'NeuroPilot GitHub',
                    href: 'https://github.com/Pasu4/neuropilot',
                },
            ],
            sidebar: [
                {
                    label: 'Guides',
                    items: [
                        {
                            label: 'Setup NeuroPilot',
                            slug: 'guides/setup',
                        },
                        {
                            label: 'Pilot modes',
                            slug: 'guides/pilot',
                        },
                    ],
                },
                {
                    label: 'Reference',
                    items: [
                        {
                            label: 'Features',
                            autogenerate: {
                                directory: 'reference/features',
                                collapsed: true
                            }
                        },
                        { label: 'Safety', slug: 'reference/safety' },
                        { label: 'Commands', slug: 'reference/commands' },
                        { label: 'Context', slug: 'reference/auto-context' },
                        { label: 'Cookies', slug: 'reference/cookies' },
                        { label: 'Permissions', slug: 'reference/permissions' },
                        { label: 'RCE', slug: 'reference/rce' },
                        { label: 'Settings', slug: 'reference/settings' },
                    ],
                },
            ],
        }),
    ],
});
