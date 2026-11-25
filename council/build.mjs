// Builds docs/index.html (GitHub Pages / home-screen app) from council/index.html (artifact-shaped source).
// The source has no <html>/<head>/<body>; this wraps it in a full document with PWA metadata.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'index.html'), 'utf8');
const title = (src.match(/<title>([^<]*)<\/title>/) || [, 'LLM 议会'])[1];
const body = src.replace(/<title>[^<]*<\/title>\s*/, '');

const head = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="五位立场互斥的 AI 议员同时审议你的难题：陈词、交锋、表决，主席敲槌定案。可配置 Claude / ChatGPT / Gemini / DeepSeek 等任意模型。">
<meta name="theme-color" content="#111A2C">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LLM 议会">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icon-180.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
`;
const out = head + body + '\n</body>\n</html>\n';
mkdirSync(join(here, '..', 'docs'), { recursive: true });
writeFileSync(join(here, '..', 'docs', 'index.html'), out);

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" rx="34" fill="#111A2C"/><rect x="34" y="34" width="112" height="112" rx="6" fill="#D8452C" transform="rotate(-3 90 90)"/><text x="90" y="124" text-anchor="middle" font-family="Noto Serif SC, Songti SC, serif" font-weight="900" font-size="88" fill="#EFE3C4">议</text></svg>`;
writeFileSync(join(here, '..', 'docs', 'icon.svg'), icon);
writeFileSync(join(here, '..', 'docs', 'manifest.webmanifest'), JSON.stringify({
  name: 'LLM 议会', short_name: 'LLM 议会', start_url: './', scope: './', display: 'standalone',
  background_color: '#111A2C', theme_color: '#111A2C', lang: 'zh-CN',
  description: '五位立场互斥的 AI 议员同时审议你的难题，主席敲槌定案。',
  icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }, { src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
}, null, 2));
console.log('built docs/index.html', out.length, 'bytes');
