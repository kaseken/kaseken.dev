import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import sharp from 'sharp';

export async function getStaticPaths() {
	const posts = await getCollection('blog', ({ data }) => !data.draft);
	return posts.map((post) => ({ params: { slug: post.id } }));
}

export async function GET({ params }: { params: { slug: string | undefined } }) {
	const posts = await getCollection('blog');
	const post = posts.find((p) => p.id === params.slug);
	if (!post) return new Response('Not found', { status: 404 });

	const { title, tags } = post.data;

	const fontRegular = fs.readFileSync(
		path.resolve('node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff')
	);
	const fontBold = fs.readFileSync(
		path.resolve('node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff')
	);

	const iconData = fs.readFileSync(path.resolve('public/favicon.png'));
	const iconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;

	const fontSize = title.length > 40 ? 52 : 68;

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: '1200px',
					height: '630px',
					background: '#13151a',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'center',
					padding: '72px 80px',
					fontFamily: 'Roboto',
					gap: '0px',
				},
				children: [
					// Main content (centered)
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								flexDirection: 'column',
								gap: '28px',
								flex: 1,
								justifyContent: 'center',
							},
							children: [
								// Title
								{
									type: 'div',
									props: {
										style: {
											color: '#e1e4eb',
											fontSize: `${fontSize}px`,
											fontWeight: 700,
											lineHeight: 1.25,
											display: 'flex',
										},
										children: title,
									},
								},
								// Tags (outline style)
								tags.length > 0
									? {
											type: 'div',
											props: {
												style: { display: 'flex', gap: '10px' },
												children: tags.map((tag) => ({
													type: 'div',
													props: {
														style: {
															background: 'transparent',
															color: '#7b8fff',
															fontSize: '22px',
															padding: '4px 14px',
															borderRadius: '4px',
															border: '1px solid #7b8fff50',
														},
														children: `#${tag}`,
													},
												})),
											},
										}
									: { type: 'div', props: { style: { display: 'flex' }, children: '' } },
							],
						},
					},
					// Separator + Author (bottom)
					{
						type: 'div',
						props: {
							style: {
								display: 'flex',
								flexDirection: 'column',
								gap: '20px',
							},
							children: [
								{
									type: 'div',
									props: {
										style: {
											width: '100%',
											height: '1px',
											background: '#252836',
											display: 'flex',
										},
										children: '',
									},
								},
								{
									type: 'div',
									props: {
										style: {
											display: 'flex',
											alignItems: 'center',
											gap: '14px',
										},
										children: [
											{
												type: 'img',
												props: {
													src: iconBase64,
													width: 40,
													height: 40,
													style: { borderRadius: '50%' },
												},
											},
											{
												type: 'div',
												props: {
													style: { color: '#5a6380', fontSize: '24px' },
													children: 'kaseken · blog.kaseken.dev',
												},
											},
										],
									},
								},
							],
						},
					},
				],
			},
		},
		{
			width: 1200,
			height: 630,
			fonts: [
				{ name: 'Roboto', data: fontRegular, weight: 400, style: 'normal' },
				{ name: 'Roboto', data: fontBold, weight: 700, style: 'normal' },
			],
		}
	);

	const png = await sharp(Buffer.from(svg)).png().toBuffer();

	return new Response(png, {
		headers: { 'Content-Type': 'image/png' },
	});
}
