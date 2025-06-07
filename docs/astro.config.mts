// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
    site: 'https://pasu4.github.io/neuropilot',
    base: '/neuropilot',
    integrations: [
        starlight({
            favicon: '/neuropilot.svg',
            title: 'NeuroPilot Docs',
            social: [
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
                        { label: 'Commands', slug: 'reference/commands' },
                        { label: 'Context', slug: 'reference/context' },
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
