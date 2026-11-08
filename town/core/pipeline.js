// One submission, end to end: read it, work out what it is, file it, review it,
// write the report back, update the index.
//
// Rules this follows, because they are what make it safe to leave running:
//   - never move the only copy of someone's work (copy by default)
//   - never review an empty string; say why it could not be read instead
//   - never review the same file twice (state is keyed on path+size+mtime)
//   - a crash on one file never stops the rest of the batch

import { readFile } from 'node:fs/promises';
import { extractText } from './extract.js';
import { classify, parseManifestCsv } from './classify.js';
import { review, reportMarkdown } from './review.js';
import { recurringFor } from './learning.js';

export async function loadManifest(path) {
  if (!path) return null;
  try { return parseManifestCsv(await readFile(path, 'utf8')); }
  catch { return null; }
}

export async function processOne(file, { drive, model, manifest = null, move = false, reviewOpts = {}, state = null }) {
  const doc = await extractText(file.path);
  const meta = await classify(file, doc, manifest);

  // Folders are named in Chinese, matching how the shared drive is already
  // organised -- a person browsing Drive should not have to read code.
  const folder = meta.typeZh;
  const filed = await drive.file(file.path, {
    project: meta.project, type: folder, filename: meta.filename, move,
  });

  const result = await review({
    name: meta.filename,
    type: meta.type,
    text: doc.text,
    project: meta.project,
    author: meta.author,
    note: meta.note,
    visual: doc.visual || false,
    image: doc.image || null,
    readError: doc.ok ? null : doc.reason,
  }, model, reviewOpts);

  const header = [
    doc.ok ? null : `> **读不出内容：** ${doc.reason}`,
    meta.guessed.length ? `> **自动判断的部分：** ${meta.guessed.join('、')}。不对的话改文件名或补 ${file.name}.town.json 后重跑。` : null,
    '',
  ].filter(l => l !== null).join('\n');

  // The person's own history, as it stood before this submission.
  const { weak } = recurringFor(state, meta.author);
  const report = await drive.writeReport(filed.path, {
    project: meta.project, type: folder, filename: meta.filename, author: meta.author,
    markdown: header + reportMarkdown(result, { weak }),
  });

  const verdicts = Object.fromEntries(result.entries.map(e => [e.agent, e.verdict]));
  return { file, meta, doc: { ok: doc.ok, reason: doc.reason, chars: doc.text?.length || 0, pages: doc.pages }, filed, report, result, verdicts, weak };
}

export async function runInbox({ drive, model, manifestPath = null, move = false, force = false, limit = 0, reviewOpts = {}, onItem = null }) {
  await drive.ensure();
  const manifest = await loadManifest(manifestPath);
  const state = await drive.readState();
  const all = await drive.listInbox();

  const pending = all.filter(f => force || !state.seen[f.key]);
  const todo = limit > 0 ? pending.slice(0, limit) : pending;

  const done = [], failed = [];
  for (const file of todo) {
    try {
      const outcome = await processOne(file, { drive, model, manifest, move, reviewOpts, state });
      state.seen[file.key] = {
        name: file.name, at: new Date().toISOString(),
        project: outcome.meta.project, type: outcome.meta.typeZh, author: outcome.meta.author,
        filed: outcome.filed.rel, report: outcome.report.rel,
        status: { 'needs-work': '要改', review: '留意', ok: '通过' }[outcome.result.status] || outcome.result.status,
        fail: outcome.result.tally.fail || 0, flag: outcome.result.tally.flag || 0,
        note: outcome.meta.note, date: outcome.meta.date,
        readOk: outcome.doc.ok,
        typeId: outcome.meta.type,
        verdicts: outcome.verdicts,
      };
      done.push(outcome);
      onItem?.({ ok: true, outcome });
    } catch (err) {
      failed.push({ file, error: err.message });
      onItem?.({ ok: false, file, error: err.message });
    }
  }

  await drive.writeState(state);
  const rows = Object.values(state.seen)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.project).localeCompare(String(b.project)))
    .map(s => ({
      date: s.date, project: s.project, type: s.type, author: s.author,
      file: s.filed, status: s.status, fail: s.fail, flag: s.flag,
      note: s.note, report: s.report,
    }));
  const indexPath = await drive.writeIndex(rows);

  return { scanned: all.length, skipped: all.length - todo.length, done, failed, indexPath, rows: rows.length };
}
