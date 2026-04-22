import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { SITE_TITLE, SITE_DESCRIPTION } from '../../consts';

export async function GET() {
	const fontRegular = fs.readFileSync(
		path.resolve('node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff')
	);
	const fontBold = fs.readFileSync(
		path.resolve('node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff')
	);

	const iconData = fs.readFileSync(path.resolve('public/favicon.png'));
	const iconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;

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
								gap: '24px',
								flex: 1,
								justifyContent: 'center',
							},
							children: [
								// Favicon + site title row
								{
									type: 'div',
									props: {
										style: {
											display: 'flex',
											alignItems: 'center',
											gap: '20px',
										},
										children: [
											{
												type: 'img',
												props: {
													src: iconBase64,
													width: 56,
													height: 56,
													style: { borderRadius: '50%' },
												},
											},
											{
												type: 'div',
												props: {
													style: {
														color: '#e1e4eb',
														fontSize: '72px',
														fontWeight: 700,
														lineHeight: 1.1,
														display: 'flex',
													},
													children: SITE_TITLE,
												},
											},
										],
									},
								},
								// Description
								{
									type: 'div',
									props: {
										style: {
											color: '#5a6380',
											fontSize: '28px',
											fontWeight: 400,
											lineHeight: 1.5,
											display: 'flex',
										},
										children: SITE_DESCRIPTION,
									},
								},
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
