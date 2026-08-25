// Bundles the ES modules + shell into one self-contained page for publishing.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MODULES = ['src/data.js', 'src/decrees.js', 'src/pdf.js', 'src/workshop.js', 'src/reading-room.js', 'src/deliverables.js', 'src/engine.js', 'src/view.js', 'src/main.js'];

function stripModuleSyntax(src) {
  return src
    // imports, single-line or spread across several lines
    .replace(/^[ \t]*import[\s\S]*?from\s+['"][^'"]*['"];?[ \t]*$/gm, '')
    .split('\n')
    .filter((l) => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(l))
    .map((l) => l.replace(/^(\s*)export\s+(async\s+function|const|let|var|function|class)\s/, '$1$2 '))
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

// Nothing may survive that only makes sense inside a module.
for (const { file, code } of chunks) {
  const leftover = code.split('\n').find((l) => /^\s*(import|export)\s/.test(l));
  if (leftover) throw new Error(`Module syntax survived stripping in ${file}: ${leftover.trim()}`);
}

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

// Parse the bundled script before shipping it: concatenation can produce
// duplicate declarations that no single module would ever show.
const script = chunks.map((c) => c.code).join('\n');
const probe = 'dist/.syntax-probe.mjs';
mkdirSync('dist', { recursive: true });
writeFileSync(probe, script);
try {
  execFileSync(process.execPath, ['--check', probe], { stdio: 'pipe' });
} catch (err) {
  rmSync(probe, { force: true });
  throw new Error(`Bundled script does not parse:\n${err.stderr ? err.stderr.toString() : err.message}`);
} finally {
  rmSync(probe, { force: true });
}

writeFileSync('dist/gradient-town.html', out);
console.log(`built dist/gradient-town.html — ${(out.length / 1024).toFixed(1)} KB`);
