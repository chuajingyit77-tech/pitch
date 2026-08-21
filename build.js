// Bundles the ES modules + shell into one self-contained page for publishing.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const MODULES = ['src/data.js', 'src/engine.js', 'src/view.js', 'src/main.js'];

function stripModuleSyntax(src) {
  return src
    .split('\n')
    .filter((l) => !/^\s*import\s.+from\s+['"].+['"];?\s*$/.test(l))
    .filter((l) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(l))
    .map((l) => l.replace(/^(\s*)export\s+(const|let|function|class)\s/, '$1$2 '))
    .join('\n');
}

// Concatenated modules share one scope: a duplicate top-level name is a hard error.
function assertNoCollisions(chunks) {
  const seen = new Map();
  const re = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const { file, code } of chunks) {
    for (const m of code.matchAll(re)) {
      const name = m[1];
      if (seen.has(name)) throw new Error(`Duplicate top-level "${name}" in ${file} and ${seen.get(name)}`);
      seen.set(name, file);
    }
  }
}

const chunks = MODULES.map((file) => ({ file, code: stripModuleSyntax(readFileSync(file, 'utf8')) }));
assertNoCollisions(chunks);

const shell = readFileSync('index.html', 'utf8');
const pick = (re, label) => {
  const m = shell.match(re);
  if (!m) throw new Error(`Could not find ${label} in index.html`);
  return m[1];
};
const title = pick(/<title>([\s\S]*?)<\/title>/, '<title>');
const fonts = pick(/(<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>)/, 'font link');
const style = pick(/<style>([\s\S]*?)<\/style>/, '<style>');
const body = pick(/<body>([\s\S]*?)<script type="module"/, '<body>');

const out = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>${style}</style>
${body.trim()}
<script type="module">
${chunks.map((c) => c.code).join('\n')}
</script>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/gradient-town.html', out);
console.log(`built dist/gradient-town.html — ${(out.length / 1024).toFixed(1)} KB`);
