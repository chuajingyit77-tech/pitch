// Load config, let the environment override it, resolve paths.

import { readFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_CONFIG = join(ROOT, 'town', 'config', 'town.config.json');

function stripComments(obj) {
  if (Array.isArray(obj)) return obj.map(stripComments);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, stripComments(v)]));
  }
  return obj;
}

const abs = p => (!p ? null : isAbsolute(p) ? p : resolve(ROOT, p));

export async function loadConfig(path = DEFAULT_CONFIG, env = process.env) {
  let raw = {};
  try { raw = stripComments(JSON.parse(await readFile(path, 'utf8'))); }
  catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`读不懂 ${path}：${err.message}`);
  }

  const drive = { backend: 'local', move: false, ...(raw.drive || {}) };
  return {
    configPath: path,
    company: env.TOWN_COMPANY || raw.company || '',
    drive: {
      ...drive,
      inbox:    abs(env.TOWN_INBOX    || drive.inbox    || 'town/_demo/inbox'),
      library:  abs(env.TOWN_LIBRARY  || drive.library  || 'town/_demo/library'),
      reports:  abs(env.TOWN_REPORTS  || drive.reports),
      manifest: abs(env.TOWN_MANIFEST || drive.manifest),
      move:     env.TOWN_MOVE ? env.TOWN_MOVE === '1' : !!drive.move,
    },
    model: raw.model || {},
    review: { concurrency: 4, only: [], skip: [], ...(raw.review || {}) },
    types: raw.types || ['proposal', 'contract', 'design', 'report', 'copy', 'other'],
    projects: raw.projects || [],
  };
}
