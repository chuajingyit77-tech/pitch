// Pull readable text out of whatever a colleague uploaded.
//
// Handles, with no dependencies:
//   .txt .md .csv .json .html   plain read
//   .pdf                        reuses the extractor already in src/pdf.js
//   .docx .pptx .xlsx           minimal ZIP reader + XML text strip
//   images / video              no text; flagged so the design checks know
//                               they need the picture itself, not a transcript
//
// Anything it cannot read comes back ok:false with a reason in plain language,
// never a silent empty string -- a review of an empty string is worse than no
// review at all.

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { extractPdfText } from '../../src/pdf.js';

const PLAIN = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.log', '.rtf']);
const OFFICE = new Set(['.docx', '.pptx', '.xlsx']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.heic', '.bmp', '.tif', '.tiff']);
const VIDEO = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DESIGN_BINARY = new Set(['.ai', '.psd', '.fig', '.sketch', '.indd', '.xd', '.afdesign']);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Read a ZIP container by its central directory. Supports stored (0) and
// deflate (8), which is everything Office and Drive actually produce.
export async function readZipEntries(buf, wanted) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = o => view.getUint32(o, true);
  const u16 = o => view.getUint16(o, true);

  let eocd = -1;
  const floor = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip file');

  const count = u16(eocd + 10);
  let p = u32(eocd + 16);
  const out = new Map();

  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (u32(p) !== 0x02014b50) break;
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOff = u32(p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (wanted && !wanted(name)) continue;
    if (u32(localOff) !== 0x04034b50) continue;
    const lNameLen = u16(localOff + 26);
    const lExtraLen = u16(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    try {
      out.set(name, method === 0 ? raw : await inflateRaw(raw));
    } catch {
      // A single unreadable member should not lose the rest of the document.
    }
  }
  return out;
}

// Turn Office XML into readable text, keeping paragraph and slide breaks.
function xmlToText(xml) {
  return xml
    .replace(/<w:p\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sortSlides(names) {
  return names.sort((a, b) => {
    const na = Number((a.match(/(\d+)/) || [])[1] ?? 0);
    const nb = Number((b.match(/(\d+)/) || [])[1] ?? 0);
    return na - nb;
  });
}

async function fromOffice(buf, ext) {
  const want = ext === '.docx'
    ? n => n === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(n)
    : ext === '.pptx'
      ? n => /^ppt\/slides\/slide\d+\.xml$/.test(n) || /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)
      : n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);

  const entries = await readZipEntries(buf, want);
  if (!entries.size) return { ok: false, text: '', reason: '档案里找不到文字内容' };

  const dec = new TextDecoder();
  if (ext === '.docx') {
    const main = entries.get('word/document.xml');
    if (!main) return { ok: false, text: '', reason: 'Word 档案缺少正文' };
    return { ok: true, text: xmlToText(dec.decode(main)), unit: 'section' };
  }

  const names = sortSlides([...entries.keys()].filter(n => !/notesSlide/.test(n)));
  const parts = [];
  for (const [i, n] of names.entries()) {
    const body = xmlToText(dec.decode(entries.get(n)));
    const notesKey = n.replace('slides/slide', 'notesSlides/notesSlide');
    const notes = entries.has(notesKey) ? xmlToText(dec.decode(entries.get(notesKey))) : '';
    parts.push(`--- ${ext === '.pptx' ? `第 ${i + 1} 页` : n} ---\n${body}${notes ? `\n[讲者备注] ${notes}` : ''}`);
  }
  return { ok: true, text: parts.join('\n\n'), pages: names.length, unit: 'slide' };
}

export async function extractText(path) {
  const ext = extname(path).toLowerCase();
  const name = basename(path);

  if (PLAIN.has(ext)) {
    const text = await readFile(path, 'utf8');
    return { ok: true, name, ext, kind: 'text', text, reason: null };
  }

  if (ext === '.pdf') {
    const bytes = new Uint8Array(await readFile(path));
    const r = await extractPdfText(bytes);
    return {
      ok: !!r.ok && !!r.legible,
      name, ext, kind: 'pdf', text: r.text || '', pages: r.pages,
      reason: r.ok ? (r.legible ? null : '这份 PDF 是扫描件或图片版，读不出文字（需要先做 OCR）') : (r.reason || '读不出 PDF 内容'),
    };
  }

  if (OFFICE.has(ext)) {
    try {
      const r = await fromOffice(new Uint8Array(await readFile(path)), ext);
      return { ok: r.ok, name, ext, kind: 'office', text: r.text, pages: r.pages, reason: r.reason ?? null };
    } catch (err) {
      return { ok: false, name, ext, kind: 'office', text: '', reason: `读不开这个档案：${err.message}` };
    }
  }

  if (ext === '.svg') {
    const raw = await readFile(path, 'utf8');
    return {
      ok: true, name, ext, kind: 'image', text: xmlToText(raw), reason: null, visual: true,
      image: Buffer.byteLength(raw) > MAX_IMAGE_BYTES ? null
        : { mediaType: 'image/svg+xml', base64: Buffer.from(raw, 'utf8').toString('base64'), bytes: Buffer.byteLength(raw) },
    };
  }

  if (IMAGE.has(ext)) {
    const bytes = await readFile(path);
    const mediaType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic' }[ext] || 'image/png';
    // Over the limit the picture goes to the model as a note, not as bytes:
    // a request that gets rejected for size teaches nobody anything.
    const tooBig = bytes.length > MAX_IMAGE_BYTES;
    return {
      ok: true, name, ext, kind: 'image', text: '', visual: true,
      image: tooBig ? null : { mediaType, base64: bytes.toString('base64'), bytes: bytes.length },
      reason: tooBig
        ? `图片 ${(bytes.length / 1048576).toFixed(1)} MB，超过 ${MAX_IMAGE_BYTES / 1048576} MB，没有送给模型看。请压缩后重交。`
        : null,
    };
  }

  if (VIDEO.has(ext)) {
    return { ok: false, name, ext, kind: 'video', text: '', visual: true,
      reason: '影片需要先转成文字稿或抽关键帧，这一版不处理。' };
  }

  if (DESIGN_BINARY.has(ext)) {
    return { ok: false, name, ext, kind: 'design-source', text: '', visual: true,
      reason: `${ext} 是设计原始档，读不出内容。请同时交一份导出的 PDF 或 PNG 供评审。` };
  }

  return { ok: false, name, ext, kind: 'unknown', text: '', reason: `不认识 ${ext || '这个'} 格式` };
}
