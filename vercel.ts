const originValue = process.env.RENDER_API_ORIGIN;
if (!originValue) {
  throw new Error('Set RENDER_API_ORIGIN to the HTTPS origin of the Render web service.');
}
const renderOrigin = new URL(originValue);

if (
  renderOrigin.protocol !== 'https:' ||
  !renderOrigin.hostname.endsWith('.onrender.com') ||
  renderOrigin.pathname !== '/' ||
  renderOrigin.port || renderOrigin.username || renderOrigin.password ||
  renderOrigin.search || renderOrigin.hash
) {
  throw new Error('Set RENDER_API_ORIGIN to the HTTPS origin of the Render web service.');
}

export const config = {
  framework: 'vite',
  installCommand: 'npm ci',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  rewrites: [{
    source: '/api/:path*',
    destination: `${renderOrigin.origin}/api/:path*`,
  }],
  headers: [{
    source: '/api/:path*',
    headers: [
      {key: 'Vercel-CDN-Cache-Control', value: 'no-store'},
      {key: 'CDN-Cache-Control', value: 'no-store'},
    ],
  }],
};
