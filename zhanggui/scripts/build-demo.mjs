// Builds the static demo: the real interface plus demo/backend.js, bundled into one HTML file
// that runs with no server. Usage: node scripts/build-demo.mjs [output directory]
//
// Two files are written:
//   index.html           a complete page, for opening locally or hosting anywhere
//   zhanggui-demo.html   the same page without <html>/<head>/<body>, for hosts that add their own
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'demo', 'dist'));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const stripModuleSyntax = (code) => code.replace(/^import .*$/gm, '').replace(/^export /gm, '');

// Each source file keeps its own scope, so names such as `esc` can exist in several of them.
const reduce = stripModuleSyntax(read('public/reduce.js'));
const deck = stripModuleSyntax(read('src/deck.js')).split('/**\n * Optional layout check')[0]; // the browser check needs Node
const backend = stripModuleSyntax(read('demo/backend.js'));
const app = stripModuleSyntax(read('public/app.js'));

const script = [
  `const { applyEvent } = (() => {\n${reduce}\nreturn { applyEvent };\n})();`,
  `const { renderDeck, reviewDeck } = (() => {\n${deck}\nreturn { renderDeck, reviewDeck };\n})();`,
  `(() => {\n${backend}\n})();`,
  app,
]
  .join('\n\n')
  .replace(/<\/script/g, '<\\/script'); // a literal closing tag inside the code would end the inline script

// The hosted page is themed by its viewer: an explicit choice sets data-theme, otherwise the system setting applies.
let css = read('public/style.css');
const dark = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}\}/.exec(css);
if (!dark) throw new Error('style.css: dark palette not found');
css = css.replace(
  dark[0],
  `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark[1]};color-scheme:dark}}\n:root[data-theme="dark"]{${dark[1]};color-scheme:dark}`,
);
css += `
/* demo page: fit inside the host's frame and keep clear of a phone's system bars */
html,body{height:100%}
#app,#main,#side{height:100%}
#topbar,#scroll,#composer,#demo-banner,#side header{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
#rail{padding-left:max(16px,env(safe-area-inset-left,0px))}
.leads{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
#demo-banner{padding-block:7px;font-size:12.5px;line-height:1.45;background:var(--soft);color:var(--ink);border-bottom:1px solid var(--line)}
/* a hosted page cannot download files or open the mail app, so those links are not offered */
a[href="api/leads.csv"],a[href^="mailto:"]{display:none}
@media (max-width:900px){#rail,#side{padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}#side{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}
`;

const page = read('public/index.html');
const body = page.slice(page.indexOf('<body>') + '<body>'.length, page.indexOf('<script type="module" src="app.js">'));

const fragment = `<title>掌柜 演示版</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${css}</style>
${body.trim()}
<script type="module">
${script}
</script>
`;

const standalone = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}[hidden]{display:none!important}</style>
</head>
<body>
${fragment}</body>
</html>
`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'zhanggui-demo.html'), fragment);
fs.writeFileSync(path.join(out, 'index.html'), standalone);
console.log(`Demo written to ${out} (${Math.round(fragment.length / 1024)} KB)`);
