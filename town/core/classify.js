// Work out what a submitted file is, who sent it, and which project it belongs
// to -- without asking the person to fill in a form twice.
//
// Sources, in order of trust:
//   1. a sidecar <file>.town.json next to the file
//   2. a manifest row (exported from the Google Form responses sheet)
//   3. the folder it was dropped into:  inbox/<project>/<type>/file.pdf
//   4. the filename convention:         项目__类型__提交人__说明.pdf
//   5. the file's own contents
//
// Anything it had to guess is reported in `guessed`, so a report never
// presents a guess as a fact.

import { readFile } from 'node:fs/promises';
import { basename, extname, join, dirname } from 'node:path';
import { DOC_TYPES } from './agents.data.js';

const TYPE_ALIASES = {
  proposal: ['proposal', '提案', '建议书', '建議書', '方案', 'quote', 'quotation', '报价', '報價'],
  contract: ['contract', '合同', '合約', '协议', '協議', 'agreement', 'mou', 'loi', 'nda', 'sla', '租约', '租約'],
  design:   ['design', '设计', '設計', 'mockup', 'artwork', 'logo', 'banner', 'poster', '海报', '海報', 'ui', 'ux'],
  report:   ['report', '报告', '報告', 'analysis', '分析', 'summary', '总结', '總結', 'minutes', '会议记录', '會議記錄'],
  copy:     ['copy', '文案', 'caption', 'script', '脚本', '腳本', 'post', 'email', '邮件', '郵件', 'newsletter'],
  other:    ['other', '其他', 'misc'],
};

const VISUAL_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ai', '.psd', '.fig', '.sketch', '.indd', '.xd', '.heic', '.tif', '.tiff']);

export function normaliseType(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  for (const [id, names] of Object.entries(TYPE_ALIASES)) {
    if (id === s) return id;
    if (names.some(n => s === n.toLowerCase() || s.includes(n.toLowerCase()))) return id;
  }
  return null;
}

// Keep the name readable in a file manager: no path separators, no control
// characters, spaces collapsed, but Chinese kept as Chinese.
export function slug(s, max = 60) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, max) || '未命名';
}

export function guessTypeFromText(text, ext) {
  if (VISUAL_EXT.has(ext)) return 'design';
  const t = (text || '').slice(0, 6000);
  if (!t.trim()) return 'other';
  const score = {
    contract: /本协议|本協議|双方同意|雙方同意|甲方|乙方|兹|茲|条款|條款|this agreement|the parties|hereby agree|whereas|governing law|终止|終止|witness\s+whereof/gi,
    proposal: /提案|建议书|建議書|报价|報價|方案|我们建议|我們建議|proposal|we propose|scope of work|投资回报|投資回報|总价|總價/gi,
    report:   /报告|報告|分析|调研|調研|结论|結論|数据显示|數據顯示|report|findings|methodology|conclusion|会议记录|會議記錄/gi,
    copy:     /文案|标题|標題|slogan|caption|subject:|亲爱的|親愛的|dear\s+[A-Z]|点击|點擊|立即|限时|限時/gi,
  };
  let best = 'other', bestN = 0;
  for (const [id, re] of Object.entries(score)) {
    const n = (t.match(re) || []).length;
    if (n > bestN) { best = id; bestN = n; }
  }
  return bestN >= 2 ? best : 'other';
}

function fromFilename(name) {
  const stem = basename(name, extname(name));
  // 项目__类型__提交人__说明
  const parts = stem.split(/__|\s*\|\s*/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const type = normaliseType(parts[1]);
    if (type) {
      return { project: parts[0], type, author: parts[2] || null, note: parts[3] || null, from: 'filename' };
    }
  }
  // Google Form attachments arrive as "Question text - Person Name.pdf"
  const form = stem.match(/^(.*?)\s+-\s+([^-]{2,40})$/);
  if (form) return { project: null, type: normaliseType(form[1]), author: form[2].trim(), note: null, from: 'form-filename' };
  return { project: null, type: normaliseType(stem), author: null, note: null, from: 'filename-weak' };
}

/**
 * file     a record from drive.listInbox()
 * doc      the result of extractText(), or null
 * manifest optional Map keyed by filename (lowercased) -> { project, type, author, note }
 */
export async function classify(file, doc, manifest = null) {
  const guessed = [];
  let project = null, type = null, author = null, note = null;

  // 1. sidecar
  try {
    const side = JSON.parse(await readFile(join(dirname(file.path), `${basename(file.path)}.town.json`), 'utf8'));
    project = side.project ?? project;
    type = normaliseType(side.type) ?? type;
    author = side.author ?? author;
    note = side.note ?? note;
  } catch { /* no sidecar, carry on */ }

  // 2. manifest from the Form responses sheet
  const row = manifest?.get(file.name.toLowerCase());
  if (row) {
    project ??= row.project || null;
    type ??= normaliseType(row.type);
    author ??= row.author || null;
    note ??= row.note || null;
  }

  // 3. folder placement: inbox/<project>/<type>/
  if (file.segments.length) {
    project ??= file.segments[0];
    if (file.segments[1]) type ??= normaliseType(file.segments[1]);
  }

  // 4. filename convention
  const fn = fromFilename(file.name);
  if (!project && fn.project) { project = fn.project; guessed.push('项目（来自文件名）'); }
  if (!type && fn.type) { type = fn.type; guessed.push('类型（来自文件名）'); }
  if (!author && fn.author) { author = fn.author; guessed.push('提交人（来自文件名）'); }
  note ??= fn.note;

  // 5. the contents
  if (!type) { type = guessTypeFromText(doc?.text, file.ext); guessed.push('类型（看内容猜的）'); }
  if (!project) { project = '未归类'; guessed.push('项目（没有资料，放进未归类）'); }
  if (!author) { author = '未署名'; guessed.push('提交人（文件里看不出来）'); }

  const date = new Date(file.mtimeMs).toISOString().slice(0, 10);
  const stem = slug(basename(file.name, file.ext).split(/__|\s*\|\s*/).pop() || file.name);
  const filename = `${date}_${slug(author, 24)}_${stem}${file.ext}`;

  return {
    project: slug(project, 48),
    type: type || 'other',
    typeZh: DOC_TYPES.find(t => t.id === type)?.zh || '其他',
    author: slug(author, 24),
    note: note || '',
    date,
    filename,
    guessed,
  };
}

// Read a manifest exported from the Google Form responses sheet.
// Accepts CSV with a header row; column names are matched loosely so you can
// rename the Form questions without editing code.
export function parseManifestCsv(csv) {
  const rows = [];
  let field = '', row = [], inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQ) {
      if (c === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return new Map();

  const head = rows[0].map(h => h.replace(/^﻿/, '').trim().toLowerCase());
  const find = (...needles) => head.findIndex(h => needles.some(n => h.includes(n)));
  const col = {
    file: find('文件', '檔案', 'file', 'upload', '附件', 'attachment'),
    project: find('项目', '項目', 'project', '客户', '客戶', 'client'),
    type: find('类型', '類型', 'type', '种类', '種類', 'category'),
    author: find('提交', '姓名', 'name', 'email', '邮箱', '郵箱', 'submit'),
    note: find('说明', '說明', 'note', 'description', '备注', '備註', '一句话'),
  };

  const out = new Map();
  for (const r of rows.slice(1)) {
    const raw = col.file >= 0 ? r[col.file] : '';
    if (!raw) continue;
    // A Form file cell can hold several Drive links or names, comma separated.
    for (const piece of raw.split(/[,;\s]+/).filter(Boolean)) {
      const name = decodeURIComponent(piece.split('/').pop().split('?')[0]).trim();
      if (!name) continue;
      out.set(name.toLowerCase(), {
        project: col.project >= 0 ? r[col.project] : null,
        type: col.type >= 0 ? r[col.type] : null,
        author: col.author >= 0 ? r[col.author] : null,
        note: col.note >= 0 ? r[col.note] : null,
      });
    }
  }
  return out;
}
