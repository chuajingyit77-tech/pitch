// File tools. Every path is confined to the session's workspace.
import fs from 'node:fs';
import path from 'node:path';

/** Resolve a model-supplied path inside root, rejecting anything that escapes it (including via symlinks). */
export function confine(root, p) {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, String(p || '.'));
  // Canonicalize the deepest part that exists, so a symlinked directory cannot lead outside.
  let existing = target;
  const tail = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  const real = path.join(fs.realpathSync(existing), ...tail);
  const rel = path.relative(realRoot, real);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`Path is outside the workspace: ${p}`);
  }
  return real;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv']);

function* walk(dir, root) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full, root);
    else if (e.isFile()) yield path.relative(root, full).split(path.sep).join('/');
  }
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const fileTools = [
  {
    name: 'read_file',
    description:
      'Read a text file from the workspace. Returns numbered lines. Use offset and limit for large files instead of reading everything.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace root' },
        offset: { type: 'integer', description: 'First line to return, starting at 1' },
        limit: { type: 'integer', description: 'Maximum number of lines (default 400)' },
      },
      required: ['path'],
    },
    tier: 'auto',
    async run({ path: p, offset = 1, limit = 400 }, ctx) {
      const lines = fs.readFileSync(confine(ctx.workspace, p), 'utf8').split('\n');
      const start = Math.max(1, offset);
      const slice = lines.slice(start - 1, start - 1 + limit);
      const body = slice.map((l, i) => `${start + i}\t${l}`).join('\n');
      const more = start - 1 + limit < lines.length ? `\n… ${lines.length} lines in total` : '';
      return body + more;
    },
  },
  {
    name: 'write_file',
    description: 'Create a file, or replace its whole contents. For a small change to an existing file use edit_file instead.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
    tier: 'edit',
    async run({ path: p, content }, ctx) {
      const target = confine(ctx.workspace, p);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return `Wrote ${p} (${content.length} characters)`;
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace one exact string in a file. old_string must appear exactly once, so include enough surrounding text to make it unique.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } },
      required: ['path', 'old_string', 'new_string'],
    },
    tier: 'edit',
    async run({ path: p, old_string, new_string }, ctx) {
      const target = confine(ctx.workspace, p);
      const text = fs.readFileSync(target, 'utf8');
      const count = text.split(old_string).length - 1;
      if (count === 0) throw new Error('old_string was not found in the file');
      if (count > 1) throw new Error(`old_string appears ${count} times; add surrounding text so it is unique`);
      fs.writeFileSync(target, text.replace(old_string, () => new_string));
      return `Edited ${p}`;
    },
  },
  {
    name: 'glob',
    description: 'List workspace files whose path matches a glob such as "src/**/*.ts". Skips node_modules and .git.',
    schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] },
    tier: 'auto',
    async run({ pattern }, ctx) {
      const re = globToRegex(pattern);
      const root = fs.realpathSync(ctx.workspace);
      const hits = [];
      for (const f of walk(root, root)) {
        if (re.test(f)) hits.push(f);
        if (hits.length >= 300) break;
      }
      return hits.length ? hits.join('\n') : 'No files matched';
    },
  },
  {
    name: 'grep',
    description: 'Search file contents in the workspace with a regular expression. Returns path:line:text for each match.',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        glob: { type: 'string', description: 'Optional glob limiting which files are searched' },
        ignore_case: { type: 'boolean' },
      },
      required: ['pattern'],
    },
    tier: 'auto',
    async run({ pattern, glob, ignore_case }, ctx) {
      const re = new RegExp(pattern, ignore_case ? 'i' : '');
      const only = glob ? globToRegex(glob) : null;
      const root = fs.realpathSync(ctx.workspace);
      const hits = [];
      for (const f of walk(root, root)) {
        if (only && !only.test(f)) continue;
        let text;
        try {
          const full = path.join(root, f);
          if (fs.statSync(full).size > 1_000_000) continue;
          text = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('\0')) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) hits.push(`${f}:${i + 1}:${lines[i].slice(0, 240)}`);
          if (hits.length >= 200) return hits.join('\n') + '\n… more matches not shown';
        }
      }
      return hits.length ? hits.join('\n') : 'No matches';
    },
  },
];
