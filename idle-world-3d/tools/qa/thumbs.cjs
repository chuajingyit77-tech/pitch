#!/usr/bin/env node
// Render dock thumbnails for every world: NODE_PATH=$(npm root -g) node thumbs.cjs reef:13 koi:16.5 ...
// Writes <root>/assets/thumbs/<id>.jpg (480x270).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..', '..');
const out = path.join(root, 'assets', 'thumbs');
fs.mkdirSync(out, { recursive: true });
const jobs = process.argv.slice(2);
for (const job of jobs) {
  const [id, hours, view] = job.split(':');
  const tmp = path.join(require('os').tmpdir(), `thumb_${id}.png`);
  const args = [path.join(__dirname, 'shoot.cjs'), '--scene', id, '--hours', hours || '14', '--out', tmp, '--w', '960', '--h', '540', '--sim', '4', '--wait', '600'];
  if (view) args.push('--view', view);
  console.log(execFileSync('node', args, { env: process.env, encoding: 'utf8' }).split('\n').filter(l => /shot|ERROR|pageerror/.test(l)).join('\n'));
  execFileSync('python3', ['-I', '-c', `from PIL import Image; im=Image.open('${tmp}').convert('RGB').resize((480,270), Image.LANCZOS); im.save('${path.join(out, id + '.jpg')}', quality=80, optimize=True)`]);
  console.log('thumb', id, fs.statSync(path.join(out, id + '.jpg')).size, 'bytes');
}
