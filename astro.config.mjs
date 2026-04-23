// @ts-check

import mdx from '@astrojs/mdx';
import partytown from '@astrojs/partytown';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://kaseken.dev',
	redirects: {
		'/dripnote/ja/support': 'https://dripnote.kaseken.dev/dripnote/ja/support',
		'/dripnote/ja/feedback': 'https://dripnote.kaseken.dev/dripnote/ja/feedback',
		'/dripnote/ja/privacy': 'https://dripnote.kaseken.dev/dripnote/ja/privacy',
	},
	integrations: [
		mdx(),
		sitemap(),
		partytown({
			config: {
				forward: ['dataLayer.push'],
				debug: false,
			},
		}),
	],
	markdown: {
		shikiConfig: {
			theme: 'github-dark',
			wrap: true,
		},
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
