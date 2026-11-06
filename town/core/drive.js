// Where the files live.
//
// The default backend is a plain folder on disk -- which is exactly what
// Google Drive for Desktop gives you: the shared drive appears as a normal
// directory, Google handles the syncing, and this system never needs an API
// key, an OAuth flow, or a token that expires. Files a colleague submits
// through a Google Form land in Drive, Drive syncs them down, and the town
// reads them from the folder.
//
// Everything below is ordinary filesystem work on purpose. If you later want
// to drive the Google API directly, implement the same four methods and pass
// it in -- nothing else in the system knows the difference.

import { readdir, stat, mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { join, resolve, basename, extname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const REVIEW_DIR = '_评审';
export const INDEX_FILE = '清单.csv';
export const STATE_FILE = '.town-state.json';

const SKIP_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', STATE_FILE, INDEX_FILE]);

function isHidden(name) { return name.startsWith('.') || name.startsWith('~$'); }

export function fileKey(relPath, size, mtimeMs) {
  return createHash('sha1').update(`${relPath}|${size}|${Math.round(mtimeMs)}`).digest('hex').slice(0, 16);
}

export function createLocalDrive({ inbox, library, reports = null }) {
  const INBOX = resolve(inbox);
  const LIBRARY = resolve(library);
  const REPORTS = reports ? resolve(reports) : null;

  async function walk(dir, base = dir, out = []) {
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return out; throw err; }
    for (const item of items) {
      if (isHidden(item.name) || SKIP_NAMES.has(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (item.name === REVIEW_DIR) continue;
        await walk(full, base, out);
      } else if (item.isFile()) {
        const s = await stat(full);
        const rel = relative(base, full);
        out.push({
          path: full,
          rel,
          segments: rel.split(sep).slice(0, -1),
          name: item.name,
          ext: extname(item.name).toLowerCase(),
          size: s.size,
          mtimeMs: s.mtimeMs,
          key: fileKey(rel, s.size, s.mtimeMs),
        });
      }
    }
    return out;
  }

  return {
    kind: 'local',
    describe() {
      return [
        `收件夹   ${INBOX}`,
        `档案库   ${LIBRARY}`,
        REPORTS ? `报告夹   ${REPORTS}` : `报告夹   随档案放在各自的 ${REVIEW_DIR}/ 里`,
      ].join('\n');
    },
    paths: { inbox: INBOX, library: LIBRARY, reports: REPORTS },

    async ensure() {
      await mkdir(INBOX, { recursive: true });
      await mkdir(LIBRARY, { recursive: true });
      if (REPORTS) await mkdir(REPORTS, { recursive: true });
    },

    listInbox() { return walk(INBOX); },
    listLibrary() { return walk(LIBRARY); },

    // Put a submission where it belongs. Copy by default: never destroy the
    // only copy of someone's work because a classifier guessed wrong.
    async file(src, { project, type, filename, move = false }) {
      const dir = join(LIBRARY, project, type);
      await mkdir(dir, { recursive: true });
      let target = join(dir, filename);
      let n = 2;
      while (await stat(target).then(() => true, () => false)) {
        const ext = extname(filename);
        target = join(dir, `${basename(filename, ext)}-${n}${ext}`);
        n++;
      }
      if (move) await rename(src, target).catch(async err => {
        if (err.code !== 'EXDEV') throw err;
        await copyFile(src, target);
      });
      else await copyFile(src, target);
      return { path: target, rel: relative(LIBRARY, target) };
    },

    async writeReport(filedPath, { project, type, filename, markdown }) {
      const dir = REPORTS ? join(REPORTS, project, type) : join(LIBRARY, project, type, REVIEW_DIR);
      await mkdir(dir, { recursive: true });
      const out = join(dir, `${basename(filename, extname(filename))}.评审.md`);
      await writeFile(out, markdown, 'utf8');
      return { path: out, rel: relative(REPORTS || LIBRARY, out) };
    },

    async readState() {
      try { return JSON.parse(await readFile(join(LIBRARY, STATE_FILE), 'utf8')); }
      catch { return { version: 1, seen: {} }; }
    },
    async writeState(state) {
      await mkdir(LIBRARY, { recursive: true });
      await writeFile(join(LIBRARY, STATE_FILE), JSON.stringify(state, null, 2), 'utf8');
    },

    // The index is a CSV on purpose: it opens in Excel and in Google Sheets,
    // and it keeps the library readable even if this program disappears.
    async writeIndex(rows) {
      const head = ['日期', '项目', '类型', '提交人', '文件', '状态', '不过', '留意', '说明', '报告'];
      const esc = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const body = rows.map(r => [r.date, r.project, r.type, r.author, r.file, r.status, r.fail, r.flag, r.note, r.report].map(esc).join(','));
      // A BOM so Excel opens the Chinese headers correctly.
      await writeFile(join(LIBRARY, INDEX_FILE), '﻿' + [head.join(','), ...body].join('\n') + '\n', 'utf8');
      return join(LIBRARY, INDEX_FILE);
    },
  };
}
